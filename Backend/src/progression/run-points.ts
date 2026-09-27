import type { RunOutcome, Verdict } from '../engine/schema';
import type { JournalEntry, RunSummary } from '../engine/types';
import type { Prisma } from '../generated/prisma/client';
import type { ScoringParams } from '../rules/rules.schema';
import { computePoints } from './scoring';

/** Поля решения, которые читает формула очков. Тексты журнала ей не нужны. */
export type PointsDecision = {
  scenarioId: string;
  choiceId: string;
  verdict: Verdict;
  reactionMs: number | null;
  timerSec: number | null;
};

export type PointsRun = {
  outcome: RunOutcome;
  loyalty: number;
  safety: number;
  decisions: readonly PointsDecision[];
};

export function asDifficulty(value: number): 1 | 2 | 3 {
  if (value >= 3) {
    return 3;
  }
  if (value <= 1) {
    return 1;
  }
  return 2;
}

/**
 * Таймаут движка — это choiceId timeout и +1 к summary.timeouts.
 * В долю скорости такое решение не входит: reactionMs пустой, штраф идёт отдельно.
 */
export function summaryForPoints(run: PointsRun): RunSummary {
  let timeouts = 0;
  const decisions: JournalEntry[] = [];
  for (const decision of run.decisions) {
    const timeout = decision.choiceId === 'timeout';
    if (timeout) {
      timeouts += 1;
    }
    decisions.push({
      idx: decisions.length,
      gameTime: '00:00',
      stage: 'enroute',
      scenarioId: decision.scenarioId,
      nodeId: 'n',
      choiceId: decision.choiceId,
      situation: '',
      action: '',
      verdict: decision.verdict,
      loyaltyDelta: 0,
      safetyDelta: 0,
      reactionMs: timeout ? null : decision.reactionMs,
      timerSec: decision.timerSec,
      consequence: null,
      lucky: false,
      better: null,
      basis: null,
      deviation: false,
    });
  }
  return {
    outcome: run.outcome,
    loyalty: run.loyalty,
    safety: run.safety,
    politeness: 0,
    timeouts,
    reactionAvgMs: 0,
    competencyDelta: {},
    decisions,
    facts: { prevented: 0, incidents: 0, complaints: 0, interventions: 0 },
  };
}

export function pointsForRun(run: PointsRun, difficulty: 1 | 2 | 3, rules: ScoringParams): number {
  return computePoints(summaryForPoints(run), difficulty, rules);
}

export async function difficultyOf(
  tx: Prisma.TransactionClient,
  scenarioIds: readonly string[],
): Promise<1 | 2 | 3> {
  const ids = [...new Set(scenarioIds)];
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
