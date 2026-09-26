import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth-user';
import { assertBrigadeAccess } from '../cabinet/access.guard';
import { applyScores } from '../cabinet/competencies';
import type { Competency } from '../engine/schema';
import { PrismaService } from '../prisma/prisma.service';
import { RulesService } from '../rules/rules.service';
import { buildFunnel } from './funnel';
import { buildGaps, type HotspotInput } from './gaps';

@Injectable()
export class AnalyticsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RulesService) private readonly rules: RulesService,
  ) {}

  async heatmap(actor: AuthUser, brigadeId: string) {
    const brigade = await this.requireBrigade(actor, brigadeId);
    const weakScore = this.rules.weakScore();
    const members = await this.prisma.user.findMany({
      where: { brigadeId: brigade.id, disabledAt: null },
      select: {
        id: true,
        callsign: true,
        position: true,
        competencyScores: { select: { competency: true, value: true } },
      },
      orderBy: { callsign: 'asc' },
    });
    return {
      brigadeId: brigade.id,
      code: brigade.code,
      weakScore,
      members: members.map((member) => ({
        userId: member.id,
        callsign: member.callsign,
        position: member.position,
        competencies: cells(applyScores(member.competencyScores), weakScore),
      })),
    };
  }

  async gaps(actor: AuthUser, brigadeId: string) {
    const brigade = await this.requireBrigade(actor, brigadeId);
    const weakScore = this.rules.weakScore();
    const failScore = this.rules.failScore();
    const scope = { brigadeId: brigade.id, disabledAt: null };
    const [users, runs, failedRuns, decisions, timeouts, grouped, scenarios] = await Promise.all([
      this.prisma.user.findMany({
        where: { brigadeId: brigade.id, disabledAt: null },
        select: { competencyScores: { select: { competency: true, value: true } } },
      }),
      this.prisma.run.count({ where: { user: scope } }),
      this.prisma.run.count({ where: { user: scope, safety: { lt: failScore } } }),
      this.prisma.runDecision.count({ where: { run: { user: scope } } }),
      this.prisma.runDecision.count({
        where: { run: { user: scope }, choiceId: 'timeout' },
      }),
      this.prisma.runDecision.groupBy({
        by: ['scenarioId', 'nodeId', 'verdict'],
        where: { run: { user: scope } },
        _count: { _all: true },
      }),
      this.prisma.scenario.findMany({
        where: { status: 'PUBLISHED' },
        select: { id: true, title: true, competencies: true, status: true },
      }),
    ]);
    const hotspots = await this.hotspots(grouped);
    return buildGaps({
      brigadeId: brigade.id,
      weakScore,
      failScore,
      members: users.map((user) => ({ scores: applyScores(user.competencyScores) })),
      runs,
      safetyFails: failedRuns,
      decisions,
      timeouts,
      hotspots,
      scenarios,
    });
  }

  async funnel(scenarioId: string) {
    const scenario = await this.prisma.scenario.findUnique({
      where: { id: scenarioId },
      select: { id: true, title: true },
    });
    if (!scenario) {
      throw new NotFoundException({ message: 'Сценарий не найден', code: 'NOT_FOUND' });
    }
    const grouped = await this.prisma.runDecision.groupBy({
      by: ['nodeId', 'choiceId'],
      where: { scenarioId },
      _count: { _all: true },
    });
    return buildFunnel(
      scenario.id,
      scenario.title,
      grouped.map((row) => ({
        nodeId: row.nodeId,
        choiceId: row.choiceId,
        count: row._count._all,
      })),
    );
  }

  private async hotspots(
    grouped: {
      scenarioId: string;
      nodeId: string;
      verdict: string;
      _count: { _all: number };
    }[],
  ): Promise<HotspotInput[]> {
    const spots = collectSpots(grouped);
    const titles = await this.scenarioTitles(spots.map((spot) => spot.scenarioId));
    return spots.map((spot) => ({
      scenarioId: spot.scenarioId,
      title: titles.get(spot.scenarioId) ?? spot.scenarioId,
      nodeId: spot.nodeId,
      attempts: spot.attempts,
      errors: spot.errors,
    }));
  }

  private async scenarioTitles(ids: string[]) {
    const unique = [...new Set(ids)];
    const map = new Map<string, string>();
    if (unique.length === 0) {
      return map;
    }
    const scenarios = await this.prisma.scenario.findMany({
      where: { id: { in: unique } },
      select: { id: true, title: true },
    });
    for (const scenario of scenarios) {
      map.set(scenario.id, scenario.title);
    }
    return map;
  }

  private async requireBrigade(actor: AuthUser, brigadeId: string) {
    assertBrigadeAccess(actor, brigadeId);
    if (!z.uuid().safeParse(brigadeId).success) {
      throw new NotFoundException({ message: 'Бригада не найдена', code: 'NOT_FOUND' });
    }
    const brigade = await this.prisma.brigade.findUnique({
      where: { id: brigadeId },
      select: { id: true, code: true },
    });
    if (!brigade) {
      throw new NotFoundException({ message: 'Бригада не найдена', code: 'NOT_FOUND' });
    }
    return brigade;
  }
}

function cells(scores: Record<Competency, number>, weakScore: number) {
  const cell = (id: Competency) => ({ value: scores[id], weak: scores[id] < weakScore });
  return {
    safety: cell('safety'),
    procedure: cell('procedure'),
    detection: cell('detection'),
    reaction: cell('reaction'),
    service: cell('service'),
    escalation: cell('escalation'),
  };
}

function collectSpots(
  grouped: { scenarioId: string; nodeId: string; verdict: string; _count: { _all: number } }[],
) {
  const spots = new Map<
    string,
    { scenarioId: string; nodeId: string; attempts: number; errors: number }
  >();
  for (const row of grouped) {
    const key = `${row.scenarioId}\n${row.nodeId}`;
    const spot = ensureSpot(spots, key, row.scenarioId, row.nodeId);
    spot.attempts += row._count._all;
    if (row.verdict === 'worse' || row.verdict === 'missed') {
      spot.errors += row._count._all;
    }
  }
  return [...spots.values()];
}

function ensureSpot(
  spots: Map<string, { scenarioId: string; nodeId: string; attempts: number; errors: number }>,
  key: string,
  scenarioId: string,
  nodeId: string,
) {
  const existing = spots.get(key);
  if (existing) {
    return existing;
  }
  const created = { scenarioId, nodeId, attempts: 0, errors: 0 };
  spots.set(key, created);
  return created;
}
