import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { activePoints, type LedgerRow, lifetimeLevelPoints } from '../cabinet/points';
import { Clock } from '../common/clock';
import { APP_CONFIG, type AppConfig } from '../config/env';
import type { Prisma } from '../generated/prisma/client';
import {
  ActorType,
  Competency,
  type Grade,
  type Role,
  RunOutcome,
} from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RulesService } from '../rules/rules.service';
import { isUniqueViolation, uniqueFields } from '../users/unique-violation';
import { UsersService } from '../users/users.service';
import type { UpsertEmployee } from './dto';
import { extHashOf, loginFromExtHash } from './ext-hash';
import { httpError } from './http-error';

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
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(Clock) private readonly clock: Clock,
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
    const [score, runs, competencies, achievements, promotion] = await Promise.all([
      this.scoreOf(user.id),
      this.runsOf(user.id),
      this.competenciesOf(user.id),
      this.achievementsOf(user.id),
      this.promotionOf(user.id),
    ]);
    return {
      callsign: user.callsign,
      grade: user.grade,
      level: this.rules.levelFor(score.levelPoints).level,
      points: score.points,
      competencies,
      runs,
      achievements,
      lastRunAt: user.lastRunAt ? user.lastRunAt.toISOString() : null,
      promotion,
    };
  }

  private async write(hash: string, input: UpsertEmployee): Promise<UpsertResult> {
    const brigadeId = await brigadeOf(this.prisma, input);
    const existing = await this.prisma.user.findUnique({
      where: { extHash: hash },
      select: { id: true },
    });
    if (existing) {
      return updateEmployee(this.prisma, existing.id, brigadeId, input);
    }
    try {
      const created = await this.users.createUser({
        login: loginFromExtHash(hash),
        role: input.role,
        position: input.position,
        grade: input.grade,
        brigadeId,
        extHash: hash,
      });
      return {
        userId: created.user.id,
        login: created.user.login,
        callsign: created.user.callsign,
        created: true,
        password: created.password,
      };
    } catch (error) {
      if (!isLoginTaken(error)) {
        throw error;
      }
      // Гонка двух PUT: первая вставка уже заняла логин и extHash.
      const updated = await this.updateByHash(hash, input);
      if (!updated) {
        throw error;
      }
      return updated;
    }
  }

  private async afterUnique(
    error: unknown,
    hash: string,
    input: UpsertEmployee,
  ): Promise<UpsertResult | 'retry' | undefined> {
    if (!isUniqueViolation(error)) {
      throw error;
    }
    const targets = uniqueFields(error);
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

  async disable(extId: string, actorId: string): Promise<void> {
    const hash = extHashOf(extId, this.config.extIdPepper);
    const user = await this.prisma.user.findUnique({
      where: { extHash: hash },
      select: { id: true, role: true, disabledAt: true },
    });
    if (!user) {
      throw httpError(404, 'Сотрудник не найден', 'EMPLOYEE_NOT_FOUND');
    }
    if (user.role === 'ADMIN' || user.role === 'METHODIST') {
      throw httpError(403, 'Кадровый ключ не отключает эту роль', 'ROLE_ESCALATION');
    }
    if (user.disabledAt) {
      return;
    }
    await this.users.update(
      user.id,
      { disabled: true },
      { id: actorId, type: ActorType.API_CLIENT },
    );
  }

  private async scoreOf(userId: string): Promise<{ levelPoints: number; points: number }> {
    const now = this.clock.now();
    const rows = await this.prisma.pointLedger.findMany({
      where: { userId },
      select: { amount: true, reason: true, expiresAt: true, expiredAt: true },
    });
    const ledger: LedgerRow[] = rows.map((row) => ({
      amount: row.amount,
      reason: row.reason,
      expiresAt: row.expiresAt,
      expiredAt: row.expiredAt,
    }));
    return { levelPoints: lifetimeLevelPoints(ledger), points: activePoints(ledger, now) };
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

type EmployeeRow = {
  id: string;
  login: string;
  callsign: string;
  role: Role;
  disabledAt: Date | null;
};

type EmployeeWrite = {
  user: {
    findUnique(args: {
      where: { id: string };
      select: { id: true; login: true; callsign: true; role: true; disabledAt: true };
    }): Promise<EmployeeRow | null>;
    updateMany(args: {
      where: { id: string; role: Role };
      data: { role: Role; position: string; grade: Grade; brigadeId: string };
    }): Promise<{ count: number }>;
  };
};

/**
 * Кадры не поднимают роль и не трогают METHODIST/ADMIN.
 * CHIEF → CONDUCTOR можно: это не повышение.
 */
export function hrMaySetRole(current: Role, next: Role): boolean {
  if (next !== 'CONDUCTOR' && next !== 'CHIEF') {
    return false;
  }
  if (current !== 'CONDUCTOR' && current !== 'CHIEF') {
    return false;
  }
  if (next === 'CHIEF') {
    return current === 'CHIEF';
  }
  return true;
}

async function updateEmployee(
  db: EmployeeWrite,
  id: string,
  brigadeId: string,
  input: UpsertEmployee,
): Promise<UpsertResult> {
  const existing = await db.user.findUnique({
    where: { id },
    select: { id: true, login: true, callsign: true, role: true, disabledAt: true },
  });
  if (!existing) {
    throw httpError(404, 'Сотрудник не найден', 'EMPLOYEE_NOT_FOUND');
  }
  if (existing.disabledAt) {
    throw httpError(409, 'Сотрудник отключён', 'EMPLOYEE_DISABLED');
  }
  if (!hrMaySetRole(existing.role, input.role)) {
    throw httpError(403, 'Кадровый ключ не повышает роль', 'ROLE_ESCALATION');
  }
  // where.role отсекает гонку: между чтением и записью роль могла вырасти.
  const updated = await db.user.updateMany({
    where: { id, role: existing.role },
    data: {
      role: input.role,
      position: input.position,
      grade: input.grade,
      brigadeId,
    },
  });
  if (updated.count !== 1) {
    throw httpError(403, 'Кадровый ключ не повышает роль', 'ROLE_ESCALATION');
  }
  return {
    userId: existing.id,
    login: existing.login,
    callsign: existing.callsign,
    created: false,
  };
}

function isLoginTaken(error: unknown): boolean {
  if (!(error instanceof ConflictException)) {
    return false;
  }
  const response = error.getResponse();
  return (
    typeof response === 'object' &&
    response !== null &&
    'code' in response &&
    response.code === 'LOGIN_TAKEN'
  );
}
