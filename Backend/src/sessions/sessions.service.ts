import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth-user';
import { Clock } from '../common/clock';
import { SESSION_TEXT_REQUESTED, type SessionTextRequestItem } from '../common/events';
import { APP_CONFIG, type AppConfig } from '../config/env';
import { EngineError } from '../engine/errors';
import { type CatalogEntry, type GenerateShiftOptions, generateShift } from '../engine/generator';
import { commitOf, createRng, newSeed } from '../engine/rng';
import type { ScenarioGraph } from '../engine/schema';
import type { ShiftPlan } from '../engine/types';
import { ActorType, type GameSession, type Prisma } from '../generated/prisma/client';
import type { LlmJobData } from '../llm/llm.constants';
import { VariantPoolService } from '../llm/variant-pool.service';
import { PrismaService } from '../prisma/prisma.service';
import { ScenariosService } from '../scenarios/scenarios.service';
import { FLAG_TICKET_REUSED, mergeFlags } from './anti-cheat';
import type { OpenedSession } from './dto';
import { weakest } from './focus';
import { SESSION_TTL_MS } from './game-cookie';
import { fromEngine, notFound, sessionClosed } from './http-errors';
import { gameLaunchUrl } from './platform-url';
import { loadRoutesFile } from './routes-file';
import { encryptSeed } from './seed-box';
import { lockUserSessions } from './session-lock';
import { isUuid, readPlan, toJson, toPublicPlan } from './state-json';
import { buildTextPlan, selectedVariantIds } from './text-plan';
import type { TicketClaims } from './ticket.service';
import { TicketService } from './ticket.service';

type OpenBody = {
  transport: 'WS';
  carClass?: ShiftPlan['carClass'];
};

type SessionActor = {
  type: ActorType;
  id: string | null;
  ip: string | null;
};

type Draft = {
  seedEnc: string;
  seedCommit: string;
  plan: ShiftPlan;
  titles: string[];
  assignmentId: string | null;
  now: Date;
  textPlan: Record<string, string | null> | null;
  live: SessionTextRequestItem[];
};

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);
  private readonly routes = loadRoutesFile();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ScenariosService) private readonly scenarios: ScenariosService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(TicketService) private readonly tickets: TicketService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(VariantPoolService) private readonly pool: VariantPoolService,
  ) {}

  async open(user: AuthUser, body: OpenBody, ip: string | null): Promise<OpenedSession> {
    const now = this.clock.now();
    const draft = await this.prepare(user.id, body, now);
    const saved = await this.prisma.$transaction((tx) =>
      this.persistOpen(tx, user.id, body.transport, draft, ip),
    );
    await this.pool.enqueueRefills(saved.refills);
    if (saved.kind === 'existing') {
      return this.resume(saved.row, ip);
    }
    if (draft.live.length > 0) {
      await this.events.emitAsync(SESSION_TEXT_REQUESTED, {
        sessionId: saved.row.id,
        items: draft.live,
      });
    }
    const ticket = await this.tickets.sign(user.id, saved.row.id);
    return this.opened(saved.row, ticket, draft.plan, draft.titles);
  }

  async abort(
    userId: string,
    sessionId: string,
    ip: string | null,
  ): Promise<{ status: 'ABORTED' }> {
    const session = await this.owned(userId, sessionId);
    const now = this.clock.now();
    const updated = await this.prisma.gameSession.updateMany({
      where: { id: session.id, userId, status: { in: ['PENDING', 'ACTIVE'] } },
      data: { status: 'ABORTED', finishedAt: now },
    });
    if (updated.count !== 1) {
      throw sessionClosed();
    }
    await this.audit.log({
      actorType: ActorType.USER,
      actorId: userId,
      action: 'session.aborted',
      target: session.id,
      ip,
    });
    await this.releaseVariants(session.id);
    return { status: 'ABORTED' };
  }

  async expireDue(): Promise<number> {
    const now = this.clock.now();
    const due = await this.prisma.gameSession.findMany({
      where: { status: { in: ['PENDING', 'ACTIVE'] }, expiresAt: { lt: now } },
      select: { id: true },
    });
    let expired = 0;
    for (const row of due) {
      const did = await this.expireOne(row.id, now);
      if (did) {
        expired += 1;
      }
    }
    return expired;
  }

  private async prepare(userId: string, body: OpenBody, now: Date): Promise<Draft> {
    const [entries, focus, assignment] = await Promise.all([
      this.catalogEntries(),
      this.focusOf(userId),
      this.plannedAssignment(userId),
    ]);
    const seed = newSeed();
    const plan = this.safePlan(seed, entries, {
      carClass: body.carClass ?? assignment?.carClass,
      focus,
      assigned: assignment?.scenarioIds ?? [],
    });
    const graphs = await this.graphsFor(plan);
    const assembly = await buildTextPlan(createRng(seed), plan, graphs, async (query, fork) => {
      const chosen = await this.pool.pick(
        query.scenarioId,
        query.version,
        query.nodeId,
        fork,
        query.persona.length > 0 ? { persona: query.persona } : undefined,
      );
      return chosen?.id ?? null;
    });
    return {
      seedEnc: encryptSeed(seed, this.config.seedEncKey),
      seedCommit: commitOf(seed),
      plan,
      titles: await this.titlesFor(plan),
      assignmentId: assignment?.id ?? null,
      now,
      textPlan: assembly.textPlan,
      live: assembly.live,
    };
  }

  private safePlan(
    seed: Buffer,
    entries: CatalogEntry[],
    options: GenerateShiftOptions,
  ): ShiftPlan {
    try {
      return generateShift(createRng(seed), entries, options, this.routes);
    } catch (error) {
      if (error instanceof EngineError) {
        throw fromEngine(error);
      }
      throw error;
    }
  }

  private async persistOpen(
    tx: Prisma.TransactionClient,
    userId: string,
    transport: OpenBody['transport'],
    draft: Draft,
    ip: string | null,
  ): Promise<{ kind: 'existing' | 'created'; row: GameSession; refills: LlmJobData[] }> {
    await lockUserSessions(tx, userId);
    const existing = await tx.gameSession.findFirst({
      where: { userId, status: { in: ['PENDING', 'ACTIVE'] } },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      return { kind: 'existing', row: existing, refills: [] };
    }
    const shiftId = await claimShift(tx, userId, draft.assignmentId);
    const row = await tx.gameSession.create({
      data: {
        userId,
        shiftId,
        status: 'PENDING',
        transport,
        plan: toJson(draft.plan),
        ...(draft.textPlan ? { textPlan: toJson(draft.textPlan) } : {}),
        seedCommit: draft.seedCommit,
        seedEnc: draft.seedEnc,
        startedAt: null,
        expiresAt: new Date(draft.now.getTime() + SESSION_TTL_MS),
        flags: [],
      },
    });
    const refills = draft.textPlan
      ? await this.pool.markUsed(selectedVariantIds(draft.textPlan), tx)
      : [];
    await tx.auditLog.create({
      data: {
        actorType: ActorType.USER,
        actorId: userId,
        action: 'session.opened',
        target: row.id,
        ip,
        meta: toJson({ transport }),
      },
    });
    return { kind: 'created', row, refills };
  }

  private async resume(row: GameSession, ip: string | null): Promise<OpenedSession> {
    await this.audit.log({
      actorType: ActorType.USER,
      actorId: row.userId,
      action: 'session.resumed',
      target: row.id,
      ip,
    });
    const plan = readPlan(row.plan);
    const ticket = await this.tickets.sign(row.userId, row.id);
    return this.opened(row, ticket, plan, await this.titlesFor(plan));
  }

  private opened(
    row: GameSession,
    ticket: string,
    plan: ShiftPlan,
    titles: readonly string[],
  ): OpenedSession {
    return {
      sessionId: row.id,
      ticket,
      wsUrl: this.config.publicGameWsUrl,
      launchUrl: gameLaunchUrl(this.config.publicGameUrl, ticket),
      seedCommit: row.seedCommit,
      plan: toPublicPlan(plan, titles),
    };
  }

  flagTicketReuse(claims: TicketClaims): Promise<void> {
    return this.flagReuse(claims);
  }

  activatePendingSession(session: GameSession, now: Date): Promise<GameSession['status']> {
    return this.activatePending(session, now);
  }

  private async activatePending(session: GameSession, now: Date): Promise<GameSession['status']> {
    if (session.status !== 'PENDING') {
      return session.status;
    }
    await this.prisma.gameSession.updateMany({
      where: { id: session.id, status: 'PENDING' },
      data: { status: 'ACTIVE', startedAt: session.startedAt ?? now },
    });
    return 'ACTIVE';
  }

  private async noteFlag(session: GameSession, flag: string, actor: SessionActor): Promise<void> {
    if (!session.flags.includes(flag)) {
      await this.prisma.gameSession.update({
        where: { id: session.id },
        data: { flags: mergeFlags(session.flags, [flag]) },
      });
    }
    await this.audit.log({
      actorType: actor.type,
      actorId: actor.id,
      action: `anticheat.${flag}`,
      target: session.id,
      ip: actor.ip,
      meta: toJson({ flag }),
    });
  }

  private async flagReuse(claims: TicketClaims): Promise<void> {
    if (isUuid(claims.sid)) {
      const session = await this.prisma.gameSession.findUnique({ where: { id: claims.sid } });
      if (session) {
        await this.noteFlag(session, FLAG_TICKET_REUSED, {
          type: ActorType.GAME_SERVER,
          id: null,
          ip: null,
        });
        return;
      }
    }
    await this.audit.log({
      actorType: ActorType.GAME_SERVER,
      action: 'anticheat.ticket-reused',
      target: claims.sid,
      meta: toJson({ flag: FLAG_TICKET_REUSED, userId: claims.sub }),
    });
  }

  private async expireOne(id: string, now: Date): Promise<boolean> {
    const updated = await this.prisma.gameSession.updateMany({
      where: { id, status: { in: ['PENDING', 'ACTIVE'] }, expiresAt: { lt: now } },
      data: { status: 'EXPIRED', finishedAt: now },
    });
    if (updated.count !== 1) {
      return false;
    }
    await this.audit.log({
      actorType: ActorType.SYSTEM,
      action: 'session.expired',
      target: id,
    });
    await this.releaseVariants(id);
    return true;
  }

  private async releaseVariants(sessionId: string): Promise<void> {
    try {
      await this.pool.releaseSession(sessionId);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      this.logger.warn(`не отпустить варианты сессии ${sessionId}: ${text}`);
    }
  }

  private async catalogEntries(): Promise<CatalogEntry[]> {
    const items = await this.scenarios.getCatalog();
    const entries: CatalogEntry[] = [];
    for (const item of items) {
      const stored = await this.scenarios.getVersion(item.id, item.version);
      entries.push({
        id: item.id,
        version: item.version,
        carClasses: item.carClasses,
        competencies: item.competencies,
        difficulty: item.difficulty,
        stage: item.stage,
        params: stored.graph.params,
      });
    }
    return entries;
  }

  private async graphsFor(plan: ShiftPlan): Promise<ScenarioGraph[]> {
    const graphs: ScenarioGraph[] = [];
    for (const item of plan.scenarios) {
      const stored = await this.scenarios.getVersion(item.scenarioId, item.version);
      graphs.push(stored.graph);
    }
    return graphs;
  }

  private async titlesFor(plan: ShiftPlan): Promise<string[]> {
    const titles: string[] = [];
    for (const item of plan.scenarios) {
      const row = await this.prisma.scenario.findUnique({
        where: { id: item.scenarioId },
        select: { title: true },
      });
      titles.push(row?.title ?? item.scenarioId);
    }
    return titles;
  }

  private async focusOf(userId: string) {
    const rows = await this.prisma.competencyScore.findMany({
      where: { userId },
      select: { competency: true, value: true },
    });
    return weakest(rows, 2);
  }

  private plannedAssignment(userId: string) {
    return this.prisma.shiftAssignment.findFirst({
      where: { userId, status: 'PLANNED' },
      orderBy: [{ departureAt: 'asc' }, { createdAt: 'asc' }],
    });
  }

  private async owned(userId: string, sessionId: string): Promise<GameSession> {
    if (!isUuid(sessionId)) {
      throw notFound();
    }
    const session = await this.prisma.gameSession.findFirst({
      where: { id: sessionId, userId },
    });
    if (!session) {
      throw notFound();
    }
    return session;
  }
}

async function claimShift(
  tx: Prisma.TransactionClient,
  userId: string,
  assignmentId: string | null,
): Promise<string | null> {
  if (!assignmentId) {
    return null;
  }
  const updated = await tx.shiftAssignment.updateMany({
    where: { id: assignmentId, userId, status: 'PLANNED' },
    data: { status: 'STARTED' },
  });
  return updated.count === 1 ? assignmentId : null;
}
