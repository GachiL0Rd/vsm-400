import type { RunOutcome, Stage, Verdict } from '../engine/schema';
import { type AchievementRule, type Where, whereFiltersDecisions } from './achievement.schema';

type ScenarioCategory = NonNullable<Where['category']>;

export type DecisionView = {
  idx: number;
  stage: Stage;
  scenarioId: string;
  category: ScenarioCategory | null;
  choiceId: string;
  situation: string;
  verdict: Verdict;
  reactionMs: number | null;
  safetyDelta: number;
  loyaltyDelta: number;
  lucky: boolean;
  deviation: boolean;
};

export type RunFacts = {
  prevented: number;
  incidents: number;
  complaints: number;
  interventions: number;
};

export type RunView = {
  outcome: RunOutcome;
  safety: number;
  loyalty: number;
  suspicious: boolean;
  /** Решения с choiceId timeout. В таблице Run такой колонки нет. */
  timeouts: number;
  facts: RunFacts;
  decisions: DecisionView[];
};

export type RuleProgress = {
  progress: number;
  earned: boolean;
};

function matchesIdentity(decision: DecisionView, where: Where): boolean {
  if (where.verdict !== undefined && decision.verdict !== where.verdict) {
    return false;
  }
  if (where.stage !== undefined && decision.stage !== where.stage) {
    return false;
  }
  if (where.category !== undefined && decision.category !== where.category) {
    return false;
  }
  if (where.categories !== undefined) {
    if (decision.category === null || !where.categories.includes(decision.category)) {
      return false;
    }
  }
  return true;
}

function matchesReaction(decision: DecisionView, where: Where): boolean {
  if (where.maxReactionMs !== undefined) {
    if (decision.reactionMs === null || decision.reactionMs > where.maxReactionMs) {
      return false;
    }
  }
  if (where.minReactionMs !== undefined) {
    if (decision.reactionMs === null || decision.reactionMs < where.minReactionMs) {
      return false;
    }
  }
  return true;
}

function matchesFlags(decision: DecisionView, where: Where): boolean {
  if (where.lucky !== undefined && decision.lucky !== where.lucky) {
    return false;
  }
  if (where.deviation !== undefined && decision.deviation !== where.deviation) {
    return false;
  }
  if (where.minSafetyDelta !== undefined && decision.safetyDelta < where.minSafetyDelta) {
    return false;
  }
  return true;
}

function matchesText(decision: DecisionView, where: Where): boolean {
  if (where.choiceIncludes !== undefined && !decision.choiceId.includes(where.choiceIncludes)) {
    return false;
  }
  if (where.situationIncludes !== undefined) {
    const needle = where.situationIncludes.toLowerCase();
    if (!decision.situation.toLowerCase().includes(needle)) {
      return false;
    }
  }
  return true;
}

export function decisionMatches(decision: DecisionView, where: Where): boolean {
  return (
    matchesIdentity(decision, where) &&
    matchesReaction(decision, where) &&
    matchesFlags(decision, where) &&
    matchesText(decision, where)
  );
}

function missedCount(run: RunView): number {
  let count = 0;
  for (const decision of run.decisions) {
    if (decision.verdict === 'missed') {
      count += 1;
    }
  }
  return count;
}

function factsOk(run: RunView, where: Where): boolean {
  if (where.complaintsMax !== undefined && run.facts.complaints > where.complaintsMax) {
    return false;
  }
  if (where.incidentsMax !== undefined && run.facts.incidents > where.incidentsMax) {
    return false;
  }
  if (where.preventedMin !== undefined && run.facts.prevented < where.preventedMin) {
    return false;
  }
  if (where.interventionsMin !== undefined && run.facts.interventions < where.interventionsMin) {
    return false;
  }
  return true;
}

function runLimitsOk(run: RunView, where: Where): boolean {
  if (!factsOk(run, where)) {
    return false;
  }
  if (where.minSafety !== undefined && run.safety < where.minSafety) {
    return false;
  }
  if (where.missedMax !== undefined && missedCount(run) > where.missedMax) {
    return false;
  }
  if (where.timeoutsMax !== undefined && run.timeouts > where.timeoutsMax) {
    return false;
  }
  if (where.minDecisions !== undefined && run.decisions.length < where.minDecisions) {
    return false;
  }
  return true;
}

export function runLevelOk(run: RunView, where: Where): boolean {
  if (where.outcome !== undefined && run.outcome !== where.outcome) {
    return false;
  }
  return runLimitsOk(run, where);
}

export function runMatches(run: RunView, where: Where): boolean {
  if (!runLevelOk(run, where)) {
    return false;
  }
  if (!whereFiltersDecisions(where)) {
    return true;
  }
  const need = where.minMatches ?? 1;
  let found = 0;
  for (const decision of run.decisions) {
    if (!decisionMatches(decision, where)) {
      continue;
    }
    found += 1;
    if (found >= need) {
      return true;
    }
  }
  return false;
}

export function countMatchingDecisions(runs: readonly RunView[], where: Where): number {
  let total = 0;
  for (const run of runs) {
    if (!runLevelOk(run, where)) {
      continue;
    }
    for (const decision of run.decisions) {
      if (decisionMatches(decision, where)) {
        total += 1;
      }
    }
  }
  return total;
}

/**
 * Прогресс считается заново по истории, а не прибавляется.
 * Повтор run.recorded не двигает полоску и не выдаёт знак второй раз.
 */
export function evaluateRule(
  rule: AchievementRule,
  runs: readonly RunView[],
  streakDays: number,
): RuleProgress {
  if (rule.type === 'streak') {
    const progress = Math.min(rule.total, Math.max(0, streakDays));
    return { progress, earned: streakDays >= rule.total };
  }
  if (rule.type === 'count') {
    const matched = countMatchingDecisions(runs, rule.where);
    return { progress: Math.min(rule.total, matched), earned: matched >= rule.total };
  }
  const earned = runs.some((run) => runMatches(run, rule.where));
  return { progress: earned ? 1 : 0, earned };
}
