import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { Cron, CronExpression } from '@nestjs/schedule';
import { z } from 'zod';
import { Clock } from '../common/clock';
import { acquireCronLock, cronWindow } from '../common/cron-lock';
import {
  RUN_COMPLETED,
  RUN_RECORDED,
  type RunCompletedPayload,
  type RunRecordedPayload,
} from '../common/events';
import { CarClassSchema } from '../engine/schema';
import type { JournalEntry } from '../engine/types';
import { ActorType, Competency, type Prisma, type RunOutcome } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { RulesService } from '../rules/rules.service';
import { isUniqueViolation } from '../users/unique-violation';
import { assertUuid, lockUser } from './lock-user';
import { difficultyOf, pointsForRun } from './run-points';
import { ewmaCompetency, NEUTRAL_COMPETENCY } from './scoring';
import { nextStreak } from './streak';
import { decisionList, isRunOutcome, summaryViolations } from './summary-invariants';

const COMPETENCIES = [
  Competency.safety,
  Competency.procedure,
  Competency.detection,
  Competency.reaction,
  Competency.service,
  Competency.escalation,
] as const;

const SessionPlanSchema = z.object({
  train: z.string().min(1),
  route: z.string().min(1),
  car: z.number().int().positive(),
  carClass: CarClassSchema,
});

const DAY_MS = 86_400_000;
/** Не подхватывать рейс, чьи слушатели ещё могут идти в запросе хода. */
const EFFECTS_LAG_MS = 60_000;
const RECONCILE_BATCH = 50;
const CRON_MINUTE_TTL_MS = 55_000;

function isCompetency(key: string): key is Competency {
  return (COMPETENCIES as readonly string[]).includes(key);
}

function scale(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(100, Math.max(0, Math.round(value)));
}

function asInt(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.round(value);
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function outcomeNote(outcome: RunOutcome): string {
  if (outcome === 'completed') {
    return 'Рейс завершён';
  }
  if (outcome === 'incident') {
    return 'Инцидент в рейсе';
  }
  return 'Рейс прерван';
}

function playSeconds(startedAt: Date | null, finishedAt: Date): number {
  if (!startedAt) {
    return 0;
  }
  const seconds = Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000);
  if (!Number.isFinite(seconds) || seconds < 0) {
    return 0;
  }
  return seconds;
}

function readPlan(plan: unknown): z.infer<typeof SessionPlanSchema> {
  const parsed = SessionPlanSchema.safeParse(plan);
  if (!parsed.success) {
    throw new Error('План сессии без поезда, маршрута или вагона');
  }
  return parsed.data;
}

function mapDecision(entry: JournalEntry) {
  return {
    idx: entry.idx,
    gameTime: entry.gameTime,
    stage: entry.stage,
    scenarioId: entry.scenarioId,
    nodeId: entry.nodeId,
    choiceId: entry.choiceId,
    situation: entry.situation,
    action: entry.action,
    verdict: entry.verdict,
    loyaltyDelta: asInt(entry.loyaltyDelta),
    safetyDelta: asInt(entry.safetyDelta),
    reactionMs: entry.reactionMs === null ? null : asInt(entry.reactionMs),
    timerSec: entry.timerSec === null ? null : asInt(entry.timerSec),
    consequence: entry.consequence,
    lucky: entry.lucky,
    better: entry.better,
    basis: entry.basis,
    deviation: entry.deviation,
  };
}

function assertEvent(event: RunCompletedPayload): void {
  assertUuid(event.userId, 'Пользователь');
  assertUuid(event.runId, 'Рейс');
  assertUuid(event.sessionId, 'Сессия');
  if (!event.summary || typeof event.summary !== 'object') {
    throw new Error('В событии нет итога рейса');
  }
}

async function applyCompetencies(
  tx: Prisma.TransactionClient,
  userId: string,
  delta: RunCompletedPayload['summary']['competencyDelta'],
  alpha: number,
): Promise<void> {
  const entries = Object.entries(delta);
  if (entries.length === 0) {
    return;
  }
  const existing = await tx.competencyScore.findMany({ where: { userId } });
  const previous = new Map(existing.map((row) => [row.competency, row.value]));
  for (const [key, value] of entries) {
    if (!isCompetency(key) || typeof value !== 'number' || !Number.isFinite(value)) {
      continue;
    }
    const next = ewmaCompetency(previous.get(key) ?? NEUTRAL_COMPETENCY, value, alpha);
    await tx.competencyScore.upsert({
      where: { userId_competency: { userId, competency: key } },
      create: { userId, competency: key, value: next },
      update: { value: next },
    });
  }
}

@Injectable()
export class RunRecorder {
  private readonly logger = new Logger(RunRecorder.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RulesService) private readonly rules: RulesService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}

  // promisify: без него eventemitter2 ставит слушателя на setImmediate и теряет промис.
  // Ошибка слушателя run.recorded не должна ронять уже записанный ход.
  @OnEvent(RUN_COMPLETED, { async: true, promisify: true, suppressErrors: false })
  async onRunCompleted(event: RunCompletedPayload): Promise<void> {
    const recorded = await this.record(event);
    if (!recorded) {
      return;
    }
    await this.dispatchEffects(recorded);
  }

  /**
   * Слушатели обязаны быть идемпотентными: повтор после сбоя не удваивает очки.
   * effectsAt ставится, только если payload ещё совпадает со строкой — чужой разбор не затирается.
   */
  async dispatchEffects(payload: RunRecordedPayload): Promise<boolean> {
    try {
      await this.events.emitAsync(RUN_RECORDED, payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`run.recorded ${payload.runId}: ${message}`);
      return false;
    }
    const marked = await this.prisma.run.updateMany({
      where: {
        id: payload.runId,
        effectsAt: null,
        suspicious: payload.suspicious,
        points: payload.points,
      },
      data: { effectsAt: this.clock.now() },
    });
    return marked.count === 1;
  }

  async payloadOf(runId: string): Promise<RunRecordedPayload | null> {
    const run = await this.prisma.run.findUnique({
      where: { id: runId },
      select: {
        id: true,
        userId: true,
        points: true,
        outcome: true,
        suspicious: true,
        user: { select: { brigadeId: true, brigade: { select: { depotId: true } } } },
      },
    });
    if (!run) {
      return null;
    }
    return {
      runId: run.id,
      userId: run.userId,
      brigadeId: run.user.brigadeId,
      depotId: run.user.brigade?.depotId ?? null,
      points: run.points,
      outcome: run.outcome,
      suspicious: run.suspicious,
    };
  }

  @Cron(CronExpression.EVERY_MINUTE, {
    name: 'progression-effects-reconcile',
    waitForCompletion: true,
  })
  async reconcileEffectsJob(): Promise<void> {
    const now = this.clock.now();
    const locked = await acquireCronLock(
      this.redis,
      'progression-effects-reconcile',
      cronWindow(now, 'minute'),
      CRON_MINUTE_TTL_MS,
    );
    if (!locked) {
      return;
    }
    await this.reconcileEffects(now);
  }

  async reconcileEffects(now = this.clock.now()): Promise<void> {
    const cutoff = new Date(now.getTime() - EFFECTS_LAG_MS);
    const pending = await this.prisma.run.findMany({
      where: { effectsAt: null, finishedAt: { lt: cutoff } },
      select: { id: true },
      orderBy: { finishedAt: 'asc' },
      take: RECONCILE_BATCH,
    });
    for (const row of pending) {
      const payload = await this.payloadOf(row.id);
      if (!payload) {
        continue;
      }
      await this.dispatchEffects(payload);
    }
  }

  private async record(event: RunCompletedPayload): Promise<RunRecordedPayload | null> {
    assertEvent(event);
    try {
      return await this.prisma.$transaction((tx) => this.write(tx, event));
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      const existing = await this.prisma.run.findUnique({ where: { sessionId: event.sessionId } });
      if (existing) {
        return null;
      }
      throw error;
    }
  }

  private async write(
    tx: Prisma.TransactionClient,
    event: RunCompletedPayload,
  ): Promise<RunRecordedPayload | null> {
    const locked = await lockUser(tx, event.userId);
    if (!locked) {
      throw new Error('Пользователь не найден');
    }
    const existing = await tx.run.findUnique({ where: { sessionId: event.sessionId } });
    if (existing) {
      return null;
    }
    const session = await tx.gameSession.findUnique({ where: { id: event.sessionId } });
    if (!session) {
      throw new Error('Сессия не найдена');
    }
    if (session.userId !== event.userId) {
      throw new Error('Сессия принадлежит другому пользователю');
    }
    const user = await tx.user.findUnique({
      where: { id: event.userId },
      include: { brigade: { select: { depotId: true } } },
    });
    if (!user) {
      throw new Error('Пользователь не найден');
    }

    const now = this.clock.now();
    const finishedAt = session.finishedAt ?? now;
    const plan = readPlan(session.plan);
    const summary = event.summary;
    const violations = summaryViolations(summary);
    // Флаг сессии уже выставил sessions. Сломанный итог — второй замок, очки всё равно ноль.
    const suspicious = event.suspicious === true || violations.length > 0;
    const decisions = decisionList(summary);
    const outcome = isRunOutcome(summary.outcome) ? summary.outcome : 'terminated';
    const difficulty = await difficultyOf(
      tx,
      decisions.map((decision) => decision.scenarioId),
    );
    const points = suspicious
      ? 0
      : pointsForRun(
          {
            outcome,
            loyalty: summary.loyalty,
            safety: summary.safety,
            decisions: decisions.map((decision) => ({
              scenarioId: decision.scenarioId,
              choiceId: decision.choiceId,
              verdict: decision.verdict,
              reactionMs: decision.reactionMs,
              timerSec: decision.timerSec,
            })),
          },
          difficulty,
          this.rules.scoring(),
        );
    const expiresAt = new Date(now.getTime() + this.rules.pointsTtlDays() * DAY_MS);
    if (violations.length > 0) {
      await tx.auditLog.create({
        data: {
          actorType: ActorType.SYSTEM,
          action: 'run.summary.invariant',
          target: event.sessionId,
          meta: toJson({
            runId: event.runId,
            violations,
            loyalty: summary.loyalty,
            safety: summary.safety,
            politeness: summary.politeness,
            outcome: summary.outcome,
            decisions: Array.isArray(summary.decisions) ? summary.decisions.length : null,
          }),
        },
      });
    }

    await tx.run.create({
      data: {
        id: event.runId,
        userId: event.userId,
        sessionId: event.sessionId,
        train: plan.train,
        route: plan.route,
        car: plan.car,
        carClass: plan.carClass,
        outcome,
        outcomeNote: outcomeNote(outcome),
        loyalty: scale(summary.loyalty),
        safety: scale(summary.safety),
        politeness: scale(summary.politeness),
        points,
        playSeconds: playSeconds(session.startedAt, finishedAt),
        competencyDelta: toJson(summary.competencyDelta),
        facts: toJson(summary.facts),
        suspicious,
        finishedAt,
        ...(decisions.length > 0 ? { decisions: { create: decisions.map(mapDecision) } } : {}),
      },
    });

    await tx.user.update({
      where: { id: event.userId },
      data: {
        streakDays: nextStreak(user.streakDays, user.lastRunAt, finishedAt),
        lastRunAt: finishedAt,
      },
    });
    await applyCompetencies(tx, event.userId, summary.competencyDelta, this.rules.ewmaAlpha());

    if (points > 0) {
      await tx.pointLedger.create({
        data: {
          userId: event.userId,
          amount: points,
          reason: 'RUN',
          runId: event.runId,
          expiresAt,
        },
      });
    }
    // «Баллы сохранятся, если пройти рейс»: срок всех ещё живых начислений сдвигается.
    await tx.pointLedger.updateMany({
      where: { userId: event.userId, expiredAt: null, expiresAt: { gt: now } },
      data: { expiresAt },
    });

    return {
      runId: event.runId,
      userId: event.userId,
      brigadeId: user.brigadeId,
      depotId: user.brigade?.depotId ?? null,
      points,
      outcome,
      suspicious,
    };
  }
}
