import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/env';
import type { Prisma } from '../generated/prisma/client';
import { Competency, RunOutcome } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RulesService } from '../rules/rules.service';
import { randomCallsign } from './callsign';
import type { UpsertEmployee } from './dto';
import { extHashOf, loginFromExtHash } from './ext-hash';
import { httpError } from './http-error';
import { generatePassword, hashPassword } from './password';

type PlaceDb = {
  depot: { findUnique(args: Prisma.DepotFindUniqueArgs): Promise<{ id: string } | null> };
  brigade: {
    findUnique(args: Prisma.BrigadeFindUniqueArgs): Promise<{ id: string } | null>;
  };
};

export type UpsertResult = {
  userId: string;
  login: string;
  callsign: string;
  created: boolean;
  password?: string;
};

const competenciesEmpty = {
  [Competency.safety]: 0,
  [Competency.procedure]: 0,
  [Competency.detection]: 0,
  [Competency.reaction]: 0,
  [Competency.service]: 0,
  [Competency.escalation]: 0,
};

@Injectable()
export class EmployeesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(RulesService) private readonly rules: RulesService,
  ) {}

  async upsert(extId: string, input: UpsertEmployee): Promise<UpsertResult> {
    const hash = extHashOf(extId, this.config.extIdPepper);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        return await this.write(hash, input);
      } catch (error) {
        const resolved = await this.afterUnique(error, hash, input);
        if (resolved === 'retry') {
          continue;
        }
        if (resolved) {
          return resolved;
        }
      }
    }
    throw httpError(409, 'Не удалось выдать позывной', 'CALLSIGN_EXHAUSTED');
  }

  async progress(extId: string) {
    const hash = extHashOf(extId, this.config.extIdPepper);
    const user = await this.prisma.user.findUnique({
      where: { extHash: hash },
      select: { id: true, callsign: true, grade: true, lastRunAt: true },
    });
    if (!user) {
      throw httpError(404, 'Сотрудник не найден', 'EMPLOYEE_NOT_FOUND');
    }
    const [points, runs, competencies, achievements, promotion] = await Promise.all([
      this.pointsOf(user.id),
      this.runsOf(user.id),
      this.competenciesOf(user.id),
      this.achievementsOf(user.id),
      this.promotionOf(user.id),
    ]);
    return {
      callsign: user.callsign,
      grade: user.grade,
      level: this.rules.levelFor(points).level,
      points,
      competencies,
      runs,
      achievements,
      lastRunAt: user.lastRunAt ? user.lastRunAt.toISOString() : null,
      promotion,
    };
  }

  private async write(hash: string, input: UpsertEmployee): Promise<UpsertResult> {
    return this.prisma.$transaction(async (tx) => {
      const brigadeId = await brigadeOf(tx, input);
      const existing = await tx.user.findUnique({
        where: { extHash: hash },
        select: { id: true },
      });
      if (existing) {
        return updateEmployee(tx, existing.id, brigadeId, input);
      }
      return createEmployee(tx, hash, brigadeId, input);
    });
  }

  private async afterUnique(
    error: unknown,
    hash: string,
    input: UpsertEmployee,
  ): Promise<UpsertResult | 'retry' | undefined> {
    if (!isP2002(error)) {
      throw error;
    }
    const targets = uniqueTargets(error);
    if (targets.some((target) => target.toLowerCase().includes('callsign'))) {
      return 'retry';
    }
    if (targets.some((target) => target.toLowerCase().includes('login'))) {
      throw httpError(409, 'Логин сотрудника уже занят', 'LOGIN_TAKEN');
    }
    return (await this.updateByHash(hash, input)) ?? undefined;
  }

  private async updateByHash(hash: string, input: UpsertEmployee): Promise<UpsertResult | null> {
    const existing = await this.prisma.user.findUnique({
      where: { extHash: hash },
      select: { id: true },
    });
    if (!existing) {
      return null;
    }
    const brigadeId = await brigadeOf(this.prisma, input);
    return updateEmployee(this.prisma, existing.id, brigadeId, input);
  }

  private async pointsOf(userId: string): Promise<number> {
    const now = new Date();
    // Живые очки: строка не погашена и срок ещё не вышел. Иначе cron опоздает и баллы зависнут.
    const sum = await this.prisma.pointLedger.aggregate({
      where: {
        userId,
        expiredAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      _sum: { amount: true },
    });
    return sum._sum.amount ?? 0;
  }

  private async runsOf(userId: string) {
    const grouped = await this.prisma.run.groupBy({
      by: ['outcome'],
      where: { userId },
      _count: { _all: true },
    });
    const runs = { total: 0, completed: 0, incidents: 0, terminated: 0 };
    for (const row of grouped) {
      const count = row._count._all;
      runs.total += count;
      if (row.outcome === RunOutcome.completed) {
        runs.completed += count;
      } else if (row.outcome === RunOutcome.incident) {
        runs.incidents += count;
      } else if (row.outcome === RunOutcome.terminated) {
        runs.terminated += count;
      }
    }
    return runs;
  }

  private async competenciesOf(userId: string) {
    const rows = await this.prisma.competencyScore.findMany({ where: { userId } });
    const competencies = { ...competenciesEmpty };
    for (const row of rows) {
      competencies[row.competency] = row.value;
    }
    return competencies;
  }

  private async achievementsOf(userId: string) {
    const rows = await this.prisma.userAchievement.findMany({
      where: { userId, earnedAt: { not: null } },
      orderBy: { earnedAt: 'asc' },
      select: { code: true, earnedAt: true },
    });
    const achievements: { code: string; earnedAt: string }[] = [];
    for (const row of rows) {
      if (row.earnedAt) {
        achievements.push({ code: row.code, earnedAt: row.earnedAt.toISOString() });
      }
    }
    return achievements;
  }

  private async promotionOf(userId: string) {
    const row = await this.prisma.promotionRecommendation.findFirst({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      fromGrade: row.fromGrade,
      toGrade: row.toGrade,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

async function brigadeOf(db: PlaceDb, input: UpsertEmployee): Promise<string> {
  const depot = await db.depot.findUnique({ where: { code: input.depotCode } });
  if (!depot) {
    throw httpError(404, 'Депо не найдено', 'DEPOT_NOT_FOUND');
  }
  const brigade = await db.brigade.findUnique({
    where: { depotId_code: { depotId: depot.id, code: input.brigadeCode } },
  });
  if (!brigade) {
    throw httpError(404, 'Бригада не найдена', 'BRIGADE_NOT_FOUND');
  }
  return brigade.id;
}

async function updateEmployee(
  db: {
    user: {
      update(args: Prisma.UserUpdateArgs): Promise<{ id: string; login: string; callsign: string }>;
    };
  },
  id: string,
  brigadeId: string,
  input: UpsertEmployee,
): Promise<UpsertResult> {
  const user = await db.user.update({
    where: { id },
    data: {
      role: input.role,
      position: input.position,
      grade: input.grade,
      brigade: { connect: { id: brigadeId } },
    },
    select: { id: true, login: true, callsign: true },
  });
  return { userId: user.id, login: user.login, callsign: user.callsign, created: false };
}

async function createEmployee(
  db: {
    user: {
      findUnique(args: Prisma.UserFindUniqueArgs): Promise<{ id: string } | null>;
      create(args: Prisma.UserCreateArgs): Promise<{ id: string; login: string; callsign: string }>;
    };
  },
  hash: string,
  brigadeId: string,
  input: UpsertEmployee,
): Promise<UpsertResult> {
  const callsign = await freeCallsign(db);
  const password = generatePassword();
  const user = await db.user.create({
    data: {
      login: loginFromExtHash(hash),
      passwordHash: hashPassword(password),
      role: input.role,
      callsign,
      extHash: hash,
      position: input.position,
      grade: input.grade,
      mustChangePassword: true,
      brigade: { connect: { id: brigadeId } },
    },
    select: { id: true, login: true, callsign: true },
  });
  return {
    userId: user.id,
    login: user.login,
    callsign: user.callsign,
    created: true,
    password,
  };
}

async function freeCallsign(db: {
  user: { findUnique(args: Prisma.UserFindUniqueArgs): Promise<{ id: string } | null> };
}): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const callsign = randomCallsign();
    const taken = await db.user.findUnique({ where: { callsign }, select: { id: true } });
    if (!taken) {
      return callsign;
    }
  }
  throw httpError(409, 'Не удалось выдать позывной', 'CALLSIGN_EXHAUSTED');
}

function isP2002(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

function uniqueTargets(error: unknown): string[] {
  if (typeof error !== 'object' || error === null || !('meta' in error)) {
    return [];
  }
  const meta = error.meta;
  if (typeof meta !== 'object' || meta === null || !('target' in meta)) {
    return [];
  }
  const target = meta.target;
  if (typeof target === 'string') {
    return [target];
  }
  if (!Array.isArray(target)) {
    return [];
  }
  return target.filter((item): item is string => typeof item === 'string');
}
