import { Inject, Injectable } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { z } from 'zod';
import {
  RUN_COMPLETED,
  RUN_RECORDED,
  type RunCompletedPayload,
  type RunRecordedPayload,
} from '../common/events';
import { CarClassSchema } from '../engine/schema';
import type { JournalEntry } from '../engine/types';
import { Competency, type Prisma, type RunOutcome } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RulesService } from '../rules/rules.service';
import { assertUuid, lockUser } from './lock-user';
import { computePoints, ewmaCompetency, NEUTRAL_COMPETENCY } from './scoring';
import { nextStreak } from './streak';

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

function isCompetency(key: string): key is Competency {
  return (COMPETENCIES as readonly string[]).includes(key);
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
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

function asDifficulty(value: number): 1 | 2 | 3 {
  if (value >= 3) {
    return 3;
  }
  if (value <= 1) {
    return 1;
  }
  return 2;
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
  if (!event.summary || !Array.isArray(event.summary.decisions)) {
    throw new Error('В событии нет итога рейса');
  }
}

async function difficultyOf(
  tx: Prisma.TransactionClient,
  decisions: readonly JournalEntry[],
): Promise<1 | 2 | 3> {
  const ids = [...new Set(decisions.map((decision) => decision.scenarioId))];
  if (ids.length === 0) {
    return 1;
  }
  const rows = await tx.scenario.findMany({
    where: { id: { in: ids } },
    select: { difficulty: true },
  });
  if (rows.length === 0) {
    return 1;
  }
  let hardest = 1;
  for (const row of rows) {
    hardest = Math.max(hardest, row.difficulty);
  }
  return asDifficulty(hardest);
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
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RulesService) private readonly rules: RulesService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
  ) {}

  // promisify: без него eventemitter2 ставит слушателя на setImmediate и теряет промис.
  @OnEvent(RUN_COMPLETED, { async: true, promisify: true, suppressErrors: false })
  async onRunCompleted(event: RunCompletedPayload): Promise<void> {
    const recorded = await this.record(event);
    if (!recorded) {
      return;
    }
    await this.events.emitAsync(RUN_RECORDED, recorded);
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

    const now = new Date();
    const finishedAt = session.finishedAt ?? now;
    const plan = readPlan(session.plan);
    const summary = event.summary;
    const suspicious = event.suspicious === true;
    const difficulty = await difficultyOf(tx, summary.decisions);
    // Подозрительный рейс пишется, но очки в рейтинг не идут. В примечание флаг не кладём.
    const points = suspicious ? 0 : computePoints(summary, difficulty, this.rules.scoring());
    const expiresAt = new Date(now.getTime() + this.rules.pointsTtlDays() * DAY_MS);

    await tx.run.create({
      data: {
        id: event.runId,
        userId: event.userId,
        sessionId: event.sessionId,
        train: plan.train,
        route: plan.route,
        car: plan.car,
        carClass: plan.carClass,
        outcome: summary.outcome,
        outcomeNote: outcomeNote(summary.outcome),
        loyalty: scale(summary.loyalty),
        safety: scale(summary.safety),
        politeness: scale(summary.politeness),
        points,
        playSeconds: playSeconds(session.startedAt, finishedAt),
        competencyDelta: toJson(summary.competencyDelta),
        facts: toJson(summary.facts),
        suspicious,
        finishedAt,
        ...(summary.decisions.length > 0
          ? { decisions: { create: summary.decisions.map(mapDecision) } }
          : {}),
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
      outcome: summary.outcome,
      suspicious,
    };
  }
}
