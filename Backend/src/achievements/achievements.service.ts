import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { ACHIEVEMENT_GRANTED, RUN_RECORDED, type RunRecordedPayload } from '../common/events';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { lockUser } from '../progression/lock-user';
import { PromotionsService } from '../progression/promotions.service';
import { RulesService } from '../rules/rules.service';
import {
  type AchievementEntry,
  type AchievementRule,
  type AchievementsFile,
  RuleSchema,
  ruleTotal,
} from './achievement.schema';
import { evaluateRule, type RunView } from './interpret';
import { loadAchievements } from './load-achievements';
import { toRunView } from './run-view';

const DAY_MS = 86_400_000;

export type AchievementCard = {
  code: string;
  title: string;
  description: string;
  earnedAt: string | null;
  progress?: { value: number; total: number };
};

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function readRule(value: unknown, code: string): AchievementRule {
  const parsed = RuleSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Правило знака ${code} в базе не совпадает со схемой`);
  }
  return parsed.data;
}

@Injectable()
export class AchievementsService implements OnModuleInit {
  private file: AchievementsFile | null = null;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RulesService) private readonly rules: RulesService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(PromotionsService) private readonly promotions: PromotionsService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.file = loadAchievements();
    // health e2e подменяет PrismaService объектом без моделей — писать справочник некуда.
    if (typeof this.prisma.achievement?.upsert !== 'function') {
      return;
    }
    await this.sync(this.file);
  }

  /**
   * emitAsync запускает слушателей параллельно.
   * Знаки и грейд идут одним слушателем: бонус этого рейса уже в леджере,
   * когда проверяется уровень (SPEC §8).
   * Подозрительный рейс знак не закрывает: бонус ушёл бы в рейтинг в обход points=0.
   */
  @OnEvent(RUN_RECORDED, { async: true, promisify: true, suppressErrors: false })
  async onRunRecorded(payload: RunRecordedPayload): Promise<void> {
    if (!payload.suspicious) {
      await this.grantForRun(payload);
    }
    await this.promotions.consider(payload.userId);
  }

  async listForUser(userId: string): Promise<AchievementCard[]> {
    const file = this.catalog();
    const known = new Set(file.achievements.map((entry) => entry.code));
    const order = new Map(file.achievements.map((entry, index) => [entry.code, index]));
    const [rows, mine] = await Promise.all([
      this.prisma.achievement.findMany(),
      this.prisma.userAchievement.findMany({ where: { userId } }),
    ]);
    const progress = new Map(mine.map((row) => [row.code, row]));
    const cards: AchievementCard[] = [];
    for (const row of rows) {
      if (!known.has(row.code)) {
        continue;
      }
      const state = progress.get(row.code);
      if (row.hidden && !state?.earnedAt) {
        continue;
      }
      const earnedAt = state?.earnedAt ? state.earnedAt.toISOString() : null;
      const card: AchievementCard = {
        code: row.code,
        title: row.title,
        description: row.description,
        earnedAt,
      };
      if (!earnedAt && row.total !== null && row.total > 0) {
        card.progress = {
          value: Math.min(row.total, state?.progress ?? 0),
          total: row.total,
        };
      }
      cards.push(card);
    }
    cards.sort((left, right) => compareCards(left, right, order));
    return cards;
  }

  private catalog(): AchievementsFile {
    if (!this.file) {
      throw new Error('Справочник ачивок не загружен');
    }
    return this.file;
  }

  private async sync(file: AchievementsFile): Promise<void> {
    for (const entry of file.achievements) {
      const data = {
        title: entry.title,
        description: entry.description,
        rule: toJson(entry.rule),
        total: ruleTotal(entry.rule),
        hidden: entry.hidden ?? false,
      };
      await this.prisma.achievement.upsert({
        where: { code: entry.code },
        create: { code: entry.code, ...data },
        update: data,
      });
    }
    const codes = file.achievements.map((entry) => entry.code);
    const stale = await this.prisma.achievement.findMany({
      where: { code: { notIn: codes } },
      include: { _count: { select: { users: true } } },
    });
    for (const row of stale) {
      if (row._count.users === 0) {
        await this.prisma.achievement.delete({ where: { code: row.code } });
      }
    }
  }

  private async grantForRun(payload: RunRecordedPayload): Promise<void> {
    const runs = await this.loadRuns(payload.userId);
    const granted = await this.prisma.$transaction(async (tx) => {
      const locked = await lockUser(tx, payload.userId);
      if (!locked) {
        return [];
      }
      const user = await tx.user.findUnique({
        where: { id: payload.userId },
        select: { streakDays: true },
      });
      if (!user) {
        return [];
      }
      const fresh: AchievementEntry[] = [];
      const now = new Date();
      for (const entry of this.catalog().achievements) {
        const earned = await this.applyEntry(tx, payload, entry, runs, user.streakDays, now);
        if (earned) {
          fresh.push(entry);
        }
      }
      return fresh;
    });
    for (const entry of granted) {
      this.events.emit(ACHIEVEMENT_GRANTED, {
        userId: payload.userId,
        code: entry.code,
        title: entry.title,
        bonusPoints: entry.bonusPoints,
      });
    }
  }

  private async loadRuns(userId: string): Promise<RunView[]> {
    const runs = await this.prisma.run.findMany({
      where: { userId, suspicious: false },
      include: { decisions: { orderBy: { idx: 'asc' } } },
      orderBy: { finishedAt: 'asc' },
    });
    const scenarioIds = new Set<string>();
    for (const run of runs) {
      for (const decision of run.decisions) {
        scenarioIds.add(decision.scenarioId);
      }
    }
    const scenarios = await this.prisma.scenario.findMany({
      where: { id: { in: [...scenarioIds] } },
      select: { id: true, category: true },
    });
    const categories = new Map(scenarios.map((row) => [row.id, row.category]));
    return runs.map((run) => toRunView(run, categories));
  }

  private async applyEntry(
    tx: Prisma.TransactionClient,
    payload: RunRecordedPayload,
    entry: AchievementEntry,
    runs: readonly RunView[],
    streakDays: number,
    now: Date,
  ): Promise<boolean> {
    const rule = readRule(entry.rule, entry.code);
    const state = evaluateRule(rule, runs, streakDays);
    const existing = await tx.userAchievement.findUnique({
      where: { userId_code: { userId: payload.userId, code: entry.code } },
    });
    if (existing?.earnedAt) {
      return false;
    }
    await tx.userAchievement.upsert({
      where: { userId_code: { userId: payload.userId, code: entry.code } },
      create: {
        userId: payload.userId,
        code: entry.code,
        progress: state.progress,
        earnedAt: state.earned ? now : null,
      },
      update: {
        progress: state.progress,
        ...(state.earned ? { earnedAt: now } : {}),
      },
    });
    if (!state.earned || entry.bonusPoints <= 0) {
      return state.earned;
    }
    await tx.pointLedger.create({
      data: {
        userId: payload.userId,
        amount: entry.bonusPoints,
        reason: 'ACHIEVEMENT',
        runId: payload.runId,
        expiresAt: new Date(now.getTime() + this.rules.pointsTtlDays() * DAY_MS),
      },
    });
    return true;
  }
}

function compareCards(
  left: AchievementCard,
  right: AchievementCard,
  order: ReadonlyMap<string, number>,
): number {
  if (left.earnedAt && right.earnedAt) {
    return right.earnedAt.localeCompare(left.earnedAt);
  }
  if (left.earnedAt) {
    return -1;
  }
  if (right.earnedAt) {
    return 1;
  }
  return (order.get(left.code) ?? 0) - (order.get(right.code) ?? 0);
}
