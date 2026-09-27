import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Clock } from '../common/clock';
import { RUN_COMPLETED, type RunCompletedPayload } from '../common/events';
import { APP_CONFIG, type AppConfig } from '../config/env';
import type { RunSummary } from '../engine/types';
import { ActorType, type GameSession } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { isSuspicious } from './anti-cheat';
import { payloadSha256 } from './canonical-json';
import { finishToSummary } from './finish-map';
import {
  attemptMismatch,
  attemptNotFound,
  invalidSession,
  resultConflict,
  sessionConsumed,
  sessionExpired,
  sessionUnavailable,
} from './http-errors';
import type { FinishedGameResult, FinishReceipt, ResolveResponse } from './platform.dto';
import { runRedirectUrl } from './platform-url';
import { SessionsService } from './sessions.service';
import { isRecord, isUuid, toJson } from './state-json';
import type { TicketClaims } from './ticket.service';
import { TicketService } from './ticket.service';

type StoredPlatform = {
  runId: string;
  hash: string | null;
  suspicious: boolean;
  summary: RunSummary | null;
};

@Injectable()
export class PlatformSessionService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TicketService) private readonly tickets: TicketService,
    @Inject(SessionsService) private readonly sessions: SessionsService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  async resolve(key: string): Promise<ResolveResponse> {
    const claims = await this.freshClaims(key);
    const session = await this.ownedSession(claims);
    if (!session) {
      throw invalidSession();
    }
    if (session.transport === 'REST' || !isOpen(session.status)) {
      throw sessionUnavailable();
    }
    await this.sessions.activatePendingSession(session, this.clock.now());
    return {
      contractVersion: 1,
      attemptId: session.id,
      gameLevelId: this.config.gameLevelId,
      mode: { kind: 'live' },
    };
  }

  async finish(attemptId: string, body: FinishedGameResult): Promise<FinishReceipt> {
    if (attemptId !== body.attemptId) {
      throw attemptMismatch();
    }
    const session = await this.findFinishSession(attemptId);
    const hash = payloadSha256(body);
    if (session.status === 'COMPLETED') {
      return this.replay(session, hash);
    }
    if (session.status !== 'ACTIVE') {
      throw attemptNotFound();
    }
    return this.complete(session, body, hash);
  }

  private async freshClaims(key: string): Promise<TicketClaims> {
    const verdict = await this.tickets.classify(key);
    if (verdict.status === 'expired') {
      throw sessionExpired();
    }
    if (verdict.status !== 'ok') {
      throw invalidSession();
    }
    const fresh = await this.tickets.consume(verdict.claims.jti);
    if (!fresh) {
      await this.sessions.flagTicketReuse(verdict.claims);
      throw sessionConsumed();
    }
    return verdict.claims;
  }

  private async ownedSession(claims: TicketClaims): Promise<GameSession | null> {
    if (!isUuid(claims.sid)) {
      return null;
    }
    const session = await this.prisma.gameSession.findUnique({ where: { id: claims.sid } });
    if (!session || session.userId !== claims.sub) {
      return null;
    }
    return session;
  }

  private async findFinishSession(attemptId: string): Promise<GameSession> {
    if (!isUuid(attemptId)) {
      throw attemptNotFound();
    }
    const session = await this.prisma.gameSession.findUnique({ where: { id: attemptId } });
    if (!session || session.transport === 'REST') {
      throw attemptNotFound();
    }
    return session;
  }

  private async complete(
    session: GameSession,
    body: FinishedGameResult,
    hash: string,
  ): Promise<FinishReceipt> {
    const summary = finishToSummary(body);
    const suspicious = isSuspicious(session.flags);
    const runId = randomUUID();
    const won = await this.persist(session, summary, suspicious, runId, hash, body);
    if (!won) {
      return this.replayLost(session.id, hash);
    }
    await this.emitCompleted({
      runId,
      userId: session.userId,
      sessionId: session.id,
      summary,
      suspicious,
    });
    return this.receipt(runId);
  }

  private async persist(
    session: GameSession,
    summary: RunSummary,
    suspicious: boolean,
    runId: string,
    hash: string,
    body: FinishedGameResult,
  ): Promise<boolean> {
    const now = this.clock.now();
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.gameSession.updateMany({
        where: { id: session.id, status: 'ACTIVE' },
        data: {
          status: 'COMPLETED',
          finishedAt: now,
          result: toJson({
            runId,
            suspicious,
            summary,
            platform: { payloadSha256: hash, result: body },
          }),
        },
      });
      if (updated.count !== 1) {
        return false;
      }
      await tx.auditLog.create({
        data: {
          actorType: ActorType.GAME_SERVER,
          action: 'session.completed',
          target: session.id,
          meta: toJson({ runId, suspicious }),
        },
      });
      return true;
    });
  }

  private async replayLost(sessionId: string, hash: string): Promise<FinishReceipt> {
    const session = await this.prisma.gameSession.findUnique({ where: { id: sessionId } });
    if (!session) {
      throw attemptNotFound();
    }
    return this.replay(session, hash);
  }

  /** Повтор того же payload. Строка run есть — событие не дублируем. Нет строки — догоняем. */
  private async replay(session: GameSession, hash: string): Promise<FinishReceipt> {
    if (session.status !== 'COMPLETED') {
      throw attemptNotFound();
    }
    const stored = readStoredPlatform(session.result);
    if (!stored || stored.hash !== hash) {
      throw resultConflict();
    }
    await this.emitIfUnrecorded(session, stored);
    return this.receipt(stored.runId);
  }

  private async emitIfUnrecorded(session: GameSession, stored: StoredPlatform): Promise<void> {
    if (!stored.summary) {
      return;
    }
    const existing = await this.prisma.run.findUnique({
      where: { sessionId: session.id },
      select: { id: true },
    });
    if (existing) {
      return;
    }
    await this.emitCompleted({
      runId: stored.runId,
      userId: session.userId,
      sessionId: session.id,
      summary: stored.summary,
      suspicious: stored.suspicious,
    });
  }

  private receipt(runId: string): FinishReceipt {
    return {
      contractVersion: 1,
      resultId: runId,
      redirectUrl: runRedirectUrl(this.config.publicAppUrl, runId),
    };
  }

  private async emitCompleted(event: RunCompletedPayload): Promise<void> {
    await this.events.emitAsync(RUN_COMPLETED, event);
  }
}

function isOpen(status: GameSession['status']): boolean {
  return status === 'PENDING' || status === 'ACTIVE';
}

function readStoredPlatform(raw: unknown): StoredPlatform | null {
  if (!isRecord(raw) || typeof raw.runId !== 'string' || raw.runId.length === 0) {
    return null;
  }
  const platform = isRecord(raw.platform) ? raw.platform : null;
  const hash =
    platform && typeof platform.payloadSha256 === 'string' ? platform.payloadSha256 : null;
  return {
    runId: raw.runId,
    hash,
    suspicious: raw.suspicious === true,
    summary: isRunSummary(raw.summary) ? raw.summary : null,
  };
}

function isRunSummary(value: unknown): value is RunSummary {
  return isRecord(value) && typeof value.outcome === 'string' && Array.isArray(value.decisions);
}
