import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { AchievementsService } from '../achievements/achievements.service';
import type { Competency } from '../engine/schema';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RulesService } from '../rules/rules.service';
import {
  applyScores,
  averageScores,
  brigadeRank,
  sumTrend,
  weakestCompetencies,
} from './competencies';
import { decodeCursor, encodeCursor } from './cursor';
import { type RawDecision, tagDecisions } from './decision-tags';
import type {
  AchievementResponse,
  CompareResponse,
  NextShiftResponse,
  ProfileResponse,
  RunDetailResponse,
  RunListResponse,
  StatsResponse,
} from './dto';
import { carClassLabel, forecastShift, formatHm, moscowDate, stationGenitive } from './forecast';
import { activePoints, type LedgerRow, lifetimeLevelPoints, nearestExpiry } from './points';
import { presentDecision, presentRun, readDelta } from './present';
import { loadScenarioIndex } from './scenario-index';
import { summarizeStats } from './stats';
import { buildWeakNotes, LAST_RUNS } from './weak-note';

const COMPARE_DAYS = 30 as const;
const DAY_MS = 24 * 60 * 60 * 1000;

type ScoreRow = { competency: Competency; value: number };

type MemberRow = {
  id: string;
  callsign: string;
  competencyScores: ScoreRow[];
};

@Injectable()
export class CabinetService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RulesService) private readonly rules: RulesService,
    @Inject(AchievementsService) private readonly achievementList: AchievementsService,
  ) {}

  async profile(userId: string, now = new Date()): Promise<ProfileResponse> {
    const user = await this.requireUser(userId);
    const [ledger, scoreRows, recent] = await Promise.all([
      this.ledger(userId),
      this.scoreRows(userId),
      this.recentRuns(userId),
    ]);
    const scores = applyScores(scoreRows);
    const trend = sumRecentTrend(recent);
    const tagged = await this.tagAll(recent.flatMap((run) => run.decisions));
    // Уровень — пожизненные RUN/ACHIEVEMENT, баллы — несгоревшие. См. points.ts.
    const band = this.rules.levelFor(lifetimeLevelPoints(ledger));
    return {
      callsign: user.callsign,
      position: user.position,
      brigade: user.brigade?.code ?? '',
      depot: user.brigade?.depot.name ?? '',
      level: band.level,
      points: activePoints(ledger, now),
      levelFrom: band.levelFrom,
      levelTo: band.levelTo,
      streakDays: user.streakDays,
      expiring: nearestExpiry(ledger, now),
      competencies: scores,
      trend,
      weakNote: buildWeakNotes({
        scores,
        trend,
        weakScore: this.rules.weakScore(),
        runIds: recent.map((run) => run.id),
        decisions: tagged,
      }),
      grade: user.grade,
    };
  }

  async stats(userId: string): Promise<StatsResponse> {
    await this.requireUser(userId);
    const [runs, decisions] = await Promise.all([
      this.prisma.run.findMany({ where: { userId }, select: { outcome: true } }),
      this.prisma.runDecision.findMany({
        where: { run: { userId } },
        select: decisionSelect,
      }),
    ]);
    return summarizeStats(runs, await this.tagAll(decisions));
  }

  async nextShift(userId: string, now = new Date()): Promise<NextShiftResponse> {
    await this.requireUser(userId);
    const planned = await this.nearestPlanned(userId, now);
    if (!planned) {
      const scores = applyScores(await this.scoreRows(userId));
      return forecastShift(userId, moscowDate(now), weakestCompetencies(scores, 2));
    }
    return {
      train: planned.train,
      from: planned.fromStation,
      fromGenitive: stationGenitive(planned.fromStation),
      to: planned.toStation,
      car: planned.car,
      carClass: carClassLabel(planned.carClass),
      departure: formatHm(planned.departureAt),
      stops: planned.stops,
      focus: await this.focusOf(userId, planned.focus),
    };
  }

  async runs(userId: string, limit: number, cursorRaw?: string): Promise<RunListResponse> {
    await this.requireUser(userId);
    const cursor = cursorRaw ? decodeCursor(cursorRaw) : undefined;
    const where: Prisma.RunWhereInput = { userId, ...cursorFilter(cursor) };
    const [total, rows] = await Promise.all([
      this.prisma.run.count({ where: { userId } }),
      this.prisma.run.findMany({
        where,
        orderBy: [{ finishedAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      }),
    ]);
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      total,
      runs: page.map((run) => presentRun(run)),
      nextCursor: rows.length > limit && last ? encodeCursor(last.finishedAt, last.id) : null,
    };
  }

  async run(userId: string, id: string): Promise<RunDetailResponse> {
    if (!z.uuid().safeParse(id).success) {
      throw new NotFoundException({ message: 'Рейс не найден', code: 'NOT_FOUND' });
    }
    const run = await this.prisma.run.findFirst({
      where: { id, userId },
      include: { decisions: { orderBy: { idx: 'asc' } } },
    });
    if (!run) {
      throw new NotFoundException({ message: 'Рейс не найден', code: 'NOT_FOUND' });
    }
    return {
      ...presentRun(run),
      decisions: run.decisions.map((decision) => presentDecision(decision)),
    };
  }

  async achievements(userId: string): Promise<AchievementResponse[]> {
    await this.requireUser(userId);
    return this.achievementList.listForUser(userId);
  }

  async compare(userId: string, now = new Date()): Promise<CompareResponse> {
    const user = await this.requireUser(userId);
    const since = new Date(now.getTime() - COMPARE_DAYS * DAY_MS);
    const mine = await this.ownSlice(userId, since);
    if (!user.brigade) {
      return {
        days: COMPARE_DAYS,
        me: { ...mine, brigadeRank: null, brigadeSize: 0 },
        brigade: null,
        depot: null,
      };
    }
    return this.compareGroups(userId, user.brigade, mine, since, now);
  }

  private async compareGroups(
    userId: string,
    brigade: { id: string; depotId: string },
    mine: Slice,
    since: Date,
    now: Date,
  ): Promise<CompareResponse> {
    const members = await this.membersOf(brigade.id);
    const [rank, brigadeScales, depotScales, depotCompetencies] = await Promise.all([
      this.rankOf(members, userId, now),
      this.scales({
        user: { brigadeId: brigade.id, disabledAt: null },
        finishedAt: { gte: since },
      }),
      this.scales({
        user: { brigade: { depotId: brigade.depotId }, disabledAt: null },
        finishedAt: { gte: since },
      }),
      this.depotScores(brigade.depotId),
    ]);
    const mineScores = members.find((member) => member.id === userId);
    return {
      days: COMPARE_DAYS,
      me: {
        ...mine,
        competencies: mineScores ? applyScores(mineScores.competencyScores) : mine.competencies,
        brigadeRank: rank.rank,
        brigadeSize: rank.size,
      },
      brigade: {
        competencies: averageScores(members.map((member) => applyScores(member.competencyScores))),
        ...brigadeScales,
      },
      depot: {
        competencies: depotCompetencies,
        ...depotScales,
      },
    };
  }

  private async ownSlice(userId: string, since: Date): Promise<Slice> {
    const [scores, scales] = await Promise.all([
      this.scoreRows(userId),
      this.scales({ userId, finishedAt: { gte: since } }),
    ]);
    return { competencies: applyScores(scores), ...scales };
  }

  private async depotScores(depotId: string) {
    const users = await this.prisma.user.findMany({
      where: { brigade: { depotId }, disabledAt: null },
      select: { competencyScores: { select: { competency: true, value: true } } },
    });
    return averageScores(users.map((user) => applyScores(user.competencyScores)));
  }

  private async rankOf(members: readonly MemberRow[], userId: string, now: Date) {
    const ledgers = await this.prisma.pointLedger.findMany({
      where: { userId: { in: members.map((member) => member.id) } },
      select: { userId: true, amount: true, reason: true, expiresAt: true, expiredAt: true },
    });
    const grouped = groupLedger(ledgers);
    return brigadeRank(
      members.map((member) => ({
        id: member.id,
        callsign: member.callsign,
        points: activePoints(grouped.get(member.id) ?? [], now),
      })),
      userId,
    );
  }

  private membersOf(brigadeId: string) {
    return this.prisma.user.findMany({
      where: { brigadeId, disabledAt: null },
      select: {
        id: true,
        callsign: true,
        competencyScores: { select: { competency: true, value: true } },
      },
    });
  }

  private async scales(where: Prisma.RunWhereInput): Promise<Scales> {
    const aggregate = await this.prisma.run.aggregate({
      where,
      _avg: { loyalty: true, safety: true, politeness: true },
    });
    return {
      loyalty: roundAvg(aggregate._avg.loyalty),
      safety: roundAvg(aggregate._avg.safety),
      politeness: roundAvg(aggregate._avg.politeness),
    };
  }

  private async nearestPlanned(userId: string, now: Date) {
    const upcoming = await this.prisma.shiftAssignment.findFirst({
      where: { userId, status: 'PLANNED', departureAt: { gte: now } },
      orderBy: [{ departureAt: 'asc' }, { id: 'asc' }],
    });
    if (upcoming) {
      return upcoming;
    }
    return this.prisma.shiftAssignment.findFirst({
      where: { userId, status: 'PLANNED', departureAt: { lt: now } },
      orderBy: [{ departureAt: 'desc' }, { id: 'desc' }],
    });
  }

  private async focusOf(userId: string, focus: Competency[]): Promise<Competency[]> {
    if (focus.length > 0) {
      return focus;
    }
    return weakestCompetencies(applyScores(await this.scoreRows(userId)), 2);
  }

  private async tagAll(rows: readonly RawDecision[]) {
    const index = await loadScenarioIndex(
      this.prisma,
      rows.map((row) => row.scenarioId),
    );
    return tagDecisions(rows, index);
  }

  private ledger(userId: string) {
    return this.prisma.pointLedger.findMany({
      where: { userId },
      select: { amount: true, reason: true, expiresAt: true, expiredAt: true },
    });
  }

  private scoreRows(userId: string) {
    return this.prisma.competencyScore.findMany({
      where: { userId },
      select: { competency: true, value: true },
    });
  }

  private recentRuns(userId: string) {
    return this.prisma.run.findMany({
      where: { userId },
      orderBy: [{ finishedAt: 'desc' }, { id: 'desc' }],
      take: LAST_RUNS,
      select: {
        id: true,
        competencyDelta: true,
        decisions: { select: decisionSelect },
      },
    });
  }

  private async requireUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      // Хеш пароля в кабинет не читаем.
      select: {
        id: true,
        callsign: true,
        position: true,
        grade: true,
        streakDays: true,
        brigade: {
          select: {
            id: true,
            code: true,
            depotId: true,
            depot: { select: { name: true } },
          },
        },
      },
    });
    if (!user) {
      throw new NotFoundException({ message: 'Сотрудник не найден', code: 'NOT_FOUND' });
    }
    return user;
  }
}

const decisionSelect = {
  runId: true,
  stage: true,
  verdict: true,
  scenarioId: true,
  nodeId: true,
  choiceId: true,
  reactionMs: true,
  lucky: true,
} as const;

type Scales = {
  loyalty: number | null;
  safety: number | null;
  politeness: number | null;
};

type Slice = Scales & { competencies: Record<Competency, number> };

function sumRecentTrend(runs: readonly { competencyDelta: unknown }[]): Record<Competency, number> {
  return sumTrend(runs.map((run) => readDelta(run.competencyDelta)));
}

function cursorFilter(cursor: { finishedAt: Date; id: string } | undefined): Prisma.RunWhereInput {
  if (!cursor) {
    return {};
  }
  return {
    OR: [
      { finishedAt: { lt: cursor.finishedAt } },
      { AND: [{ finishedAt: cursor.finishedAt }, { id: { lt: cursor.id } }] },
    ],
  };
}

function roundAvg(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }
  return Math.round(value);
}

function groupLedger(rows: readonly (LedgerRow & { userId: string })[]): Map<string, LedgerRow[]> {
  const grouped = new Map<string, LedgerRow[]>();
  for (const row of rows) {
    const list = grouped.get(row.userId);
    const entry: LedgerRow = {
      amount: row.amount,
      reason: row.reason,
      expiresAt: row.expiresAt,
      expiredAt: row.expiredAt,
    };
    if (list) {
      list.push(entry);
    } else {
      grouped.set(row.userId, [entry]);
    }
  }
  return grouped;
}
