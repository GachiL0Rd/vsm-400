import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { AuthUser } from '../auth/auth-user';
import { PROMOTION_RECOMMENDED } from '../common/events';
import {
  ActorType,
  Competency,
  type Grade,
  type Prisma,
  PromotionStatus,
  Role,
} from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RulesService } from '../rules/rules.service';
import { assertUuid, lockUser } from './lock-user';

const COMPETENCIES = [
  Competency.safety,
  Competency.procedure,
  Competency.detection,
  Competency.reaction,
  Competency.service,
  Competency.escalation,
] as const;

export type PromotionView = {
  id: string;
  userId: string;
  fromGrade: Grade;
  toGrade: Grade;
  reasons: string[];
  status: PromotionStatus;
  createdAt: string;
  decidedAt: string | null;
};

type RecommendationRow = {
  id: string;
  userId: string;
  fromGrade: Grade;
  toGrade: Grade;
  reasons: Prisma.JsonValue;
  status: PromotionStatus;
  createdAt: Date;
  decidedAt: Date | null;
};

function readReasons(value: Prisma.JsonValue): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string');
}

function toView(row: RecommendationRow): PromotionView {
  return {
    id: row.id,
    userId: row.userId,
    fromGrade: row.fromGrade,
    toGrade: row.toGrade,
    reasons: readReasons(row.reasons),
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
  };
}

function isSafetyFail(outcome: string, safety: number, failScore: number): boolean {
  return outcome === 'terminated' || safety < failScore;
}

@Injectable()
export class PromotionsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RulesService) private readonly rules: RulesService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
  ) {}

  async consider(userId: string): Promise<void> {
    const created = await this.prisma.$transaction((tx) => this.recommend(tx, userId));
    if (!created) {
      return;
    }
    this.events.emit(PROMOTION_RECOMMENDED, {
      recommendationId: created.id,
      userId: created.userId,
      fromGrade: created.fromGrade,
      toGrade: created.toGrade,
    });
  }

  async list(actor: AuthUser, status: PromotionStatus): Promise<PromotionView[]> {
    this.assertStaff(actor);
    if (actor.role === Role.CHIEF && !actor.brigadeId) {
      return [];
    }
    const rows = await this.prisma.promotionRecommendation.findMany({
      where: {
        status,
        ...(actor.role === Role.CHIEF ? { user: { brigadeId: actor.brigadeId } } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toView);
  }

  async decide(actor: AuthUser, id: string, approve: boolean): Promise<PromotionView> {
    this.assertStaff(actor);
    if (!isUuidSafe(id)) {
      throw new NotFoundException({ message: 'Рекомендация не найдена', code: 'NOT_FOUND' });
    }
    const current = await this.prisma.promotionRecommendation.findUnique({
      where: { id },
      include: { user: { select: { brigadeId: true } } },
    });
    if (!current) {
      throw new NotFoundException({ message: 'Рекомендация не найдена', code: 'NOT_FOUND' });
    }
    this.assertBrigade(actor, current.user.brigadeId);
    if (current.status !== PromotionStatus.PENDING) {
      throw new ConflictException({
        message: 'Рекомендация уже рассмотрена',
        code: 'PROMOTION_DECIDED',
      });
    }

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.promotionRecommendation.updateMany({
        where: { id, status: PromotionStatus.PENDING },
        data: {
          status: approve ? PromotionStatus.APPROVED : PromotionStatus.REJECTED,
          decidedById: actor.id,
          decidedAt: new Date(),
        },
      });
      if (updated.count !== 1) {
        throw new ConflictException({
          message: 'Рекомендация уже рассмотрена',
          code: 'PROMOTION_DECIDED',
        });
      }
      if (approve) {
        await tx.user.update({
          where: { id: current.userId },
          data: { grade: current.toGrade },
        });
      }
      await tx.auditLog.create({
        data: {
          actorType: ActorType.USER,
          actorId: actor.id,
          action: approve ? 'promotion.approved' : 'promotion.rejected',
          target: id,
          meta: {
            userId: current.userId,
            fromGrade: current.fromGrade,
            toGrade: current.toGrade,
          },
        },
      });
    });

    const saved = await this.prisma.promotionRecommendation.findUnique({ where: { id } });
    if (!saved) {
      throw new NotFoundException({ message: 'Рекомендация не найдена', code: 'NOT_FOUND' });
    }
    return toView(saved);
  }

  private assertStaff(actor: AuthUser): void {
    if (actor.role === Role.ADMIN || actor.role === Role.CHIEF) {
      return;
    }
    throw new ForbiddenException({
      message: 'Решение по грейду доступно начальнику бригады или администратору',
      code: 'FORBIDDEN',
    });
  }

  private assertBrigade(actor: AuthUser, brigadeId: string | null): void {
    if (actor.role === Role.ADMIN) {
      return;
    }
    if (actor.brigadeId && actor.brigadeId === brigadeId) {
      return;
    }
    throw new ForbiddenException({
      message: 'Начальник решает только по своей бригаде',
      code: 'FORBIDDEN',
    });
  }

  private async recommend(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<RecommendationRow | null> {
    const locked = await lockUser(tx, userId);
    if (!locked) {
      return null;
    }
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user) {
      return null;
    }
    const rule = this.rules.gradeRules().find((item) => item.from === user.grade);
    if (!rule) {
      return null;
    }
    const pending = await tx.promotionRecommendation.findFirst({
      where: { userId, status: PromotionStatus.PENDING },
    });
    if (pending) {
      return null;
    }

    const reasons = await this.reasonsFor(tx, userId, rule);
    if (!reasons) {
      return null;
    }
    return tx.promotionRecommendation.create({
      data: {
        userId,
        fromGrade: rule.from,
        toGrade: rule.to,
        reasons,
        status: PromotionStatus.PENDING,
      },
    });
  }

  private async reasonsFor(
    tx: Prisma.TransactionClient,
    userId: string,
    rule: ReturnType<RulesService['gradeRules']>[number],
  ): Promise<string[] | null> {
    const level = this.rules.levelFor(await activePoints(tx, userId)).level;
    if (level < rule.minLevel) {
      return null;
    }
    const floor = await competencyFloor(tx, userId);
    if (floor < rule.minCompetency) {
      return null;
    }
    const categories = await passedCategories(tx, userId);
    for (const category of rule.requiredCategories) {
      if (!categories.has(category)) {
        return null;
      }
    }
    const clean = await safetyWindowClean(
      tx,
      userId,
      rule.noSafetyFailsInLastRuns,
      this.rules.failScore(),
    );
    if (!clean) {
      return null;
    }
    return [
      `Уровень ${level}, нужен ${rule.minLevel}`,
      `Каждая компетенция не ниже ${rule.minCompetency}`,
      `Пройдены категории: ${rule.requiredCategories.join(', ')}`,
      `Последние ${rule.noSafetyFailsInLastRuns} рейсов без провала по безопасности`,
    ];
  }
}

function isUuidSafe(value: string): boolean {
  try {
    assertUuid(value, 'Рекомендация');
    return true;
  } catch {
    return false;
  }
}

async function activePoints(tx: Prisma.TransactionClient, userId: string): Promise<number> {
  const now = new Date();
  const rows = await tx.pointLedger.findMany({
    where: {
      userId,
      expiredAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: { amount: true },
  });
  let sum = 0;
  for (const row of rows) {
    sum += row.amount;
  }
  return Math.max(0, sum);
}

async function competencyFloor(tx: Prisma.TransactionClient, userId: string): Promise<number> {
  const rows = await tx.competencyScore.findMany({ where: { userId } });
  const scores = new Map(rows.map((row) => [row.competency, row.value]));
  let floor = 100;
  for (const competency of COMPETENCIES) {
    floor = Math.min(floor, scores.get(competency) ?? 0);
  }
  return floor;
}

/** Категория зачтена только честным завершённым рейсом: подозрительный её не открывает. */
async function passedCategories(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<Set<string>> {
  const runs = await tx.run.findMany({
    where: { userId, suspicious: false, outcome: 'completed' },
    select: { decisions: { select: { scenarioId: true } } },
  });
  const scenarioIds = new Set<string>();
  for (const run of runs) {
    for (const decision of run.decisions) {
      scenarioIds.add(decision.scenarioId);
    }
  }
  if (scenarioIds.size === 0) {
    return new Set();
  }
  const scenarios = await tx.scenario.findMany({
    where: { id: { in: [...scenarioIds] } },
    select: { category: true },
  });
  return new Set(scenarios.map((row) => row.category));
}

async function safetyWindowClean(
  tx: Prisma.TransactionClient,
  userId: string,
  count: number,
  failScore: number,
): Promise<boolean> {
  if (count === 0) {
    return true;
  }
  const runs = await tx.run.findMany({
    where: { userId },
    orderBy: { finishedAt: 'desc' },
    take: count,
    select: { outcome: true, safety: true },
  });
  if (runs.length < count) {
    return false;
  }
  return runs.every((run) => !isSafetyFail(run.outcome, run.safety, failScore));
}
