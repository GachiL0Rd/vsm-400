import type { Competency, RunOutcome, Stage, Verdict } from '../engine/schema';

export type StatDecision = {
  stage: Stage;
  verdict: Verdict;
  competencies: readonly Competency[];
  reactionMs: number | null;
  lucky: boolean;
};

export type StatsNumbers = {
  runs: number;
  completed: number;
  incidents: number;
  terminated: number;
  defectsFound: number;
  missedChecks: number;
  avgReactionSec: number;
  escalationsCorrect: number;
  escalationsTotal: number;
  luckyViolations: number;
};

export function summarizeStats(
  runs: readonly { outcome: RunOutcome }[],
  decisions: readonly StatDecision[],
): StatsNumbers {
  return {
    runs: runs.length,
    completed: countOutcome(runs, 'completed'),
    incidents: countOutcome(runs, 'incident'),
    terminated: countOutcome(runs, 'terminated'),
    defectsFound: countWhere(decisions, isFoundDefect),
    missedChecks: countWhere(decisions, (decision) => decision.verdict === 'missed'),
    avgReactionSec: averageReaction(decisions),
    escalationsCorrect: countWhere(decisions, isTimelyEscalation),
    escalationsTotal: countWhere(decisions, (decision) => hasCompetency(decision, 'escalation')),
    luckyViolations: countWhere(decisions, (decision) => decision.lucky),
  };
}

/** Найденная неисправность: верный выбор на приёмке или по обнаружению. */
function isFoundDefect(decision: StatDecision): boolean {
  if (decision.verdict !== 'best') {
    return false;
  }
  if (decision.stage === 'acceptance') {
    return true;
  }
  return hasCompetency(decision, 'detection');
}

function isTimelyEscalation(decision: StatDecision): boolean {
  return hasCompetency(decision, 'escalation') && decision.verdict === 'best';
}

function hasCompetency(decision: StatDecision, competency: Competency): boolean {
  return decision.competencies.includes(competency);
}

function countOutcome(runs: readonly { outcome: RunOutcome }[], outcome: RunOutcome): number {
  let count = 0;
  for (const run of runs) {
    if (run.outcome === outcome) {
      count += 1;
    }
  }
  return count;
}

function countWhere(
  decisions: readonly StatDecision[],
  match: (decision: StatDecision) => boolean,
): number {
  let count = 0;
  for (const decision of decisions) {
    if (match(decision)) {
      count += 1;
    }
  }
  return count;
}

function averageReaction(decisions: readonly StatDecision[]): number {
  let sum = 0;
  let count = 0;
  for (const decision of decisions) {
    if (decision.reactionMs === null) {
      continue;
    }
    sum += decision.reactionMs;
    count += 1;
  }
  if (count === 0) {
    return 0;
  }
  return Math.round((sum / count / 1000) * 10) / 10;
}
