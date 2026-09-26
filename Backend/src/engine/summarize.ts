import { clampScale } from './scale';
import type { RunOutcome, ScenarioGraph } from './schema';
import { copySkills } from './skills';
import type { EngineState, JournalEntry, RunSummary } from './types';
import {
  actionFlags,
  actionServiceSkill,
  copyEntry,
  countIncidents,
  followedEnd,
  nodeTags,
  skipUnfollowed,
} from './walk';

/**
 * Вежливость — шкала сессии, не штраф.
 * Вежливое/сервисное решение: не timeout, вердикт best или ok
 * (deviation не вычитает) и хотя бы одно из: skill service > 0,
 * компетенция сценария service, loyaltyDelta > 0.
 * Доля при пустом журнале = loyalty/100, до первого хода шкала совпадает с лояльностью.
 * politeness = clamp(round(0.5 * loyalty + 0.5 * 100 * politeShare)).
 */
export function politenessOf(
  loyalty: number,
  journal: readonly JournalEntry[],
  scenarios: readonly ScenarioGraph[],
): number {
  const total = journal.length;
  let polite = 0;
  for (const entry of journal) {
    if (isPolite(entry, scenarios)) {
      polite += 1;
    }
  }
  const share = total === 0 ? loyalty / 100 : polite / total;
  return clampScale(Math.round(0.5 * loyalty + 0.5 * 100 * share));
}

/** В RunSummary нет средней реакции — поле рядом, сессия считается целиком. */
export type RunSummaryReport = RunSummary & {
  reactionAvgMs: number;
};

export function summarize(
  state: EngineState,
  scenarios: readonly ScenarioGraph[],
): RunSummaryReport {
  return {
    outcome: summaryOutcome(state, scenarios),
    loyalty: state.loyalty,
    safety: state.safety,
    politeness: politenessOf(state.loyalty, state.journal, scenarios),
    timeouts: state.timeouts,
    reactionAvgMs: reactionAvg(state.journal),
    competencyDelta: copySkills(state.skills),
    decisions: state.journal.map((entry) => copyEntry(entry)),
    facts: {
      prevented: countPrevented(state, scenarios),
      incidents: countIncidents(state, scenarios),
      complaints: countTagged(state, scenarios, 'complaint'),
      interventions: countTagged(state, scenarios, 'intervention'),
    },
  };
}

function isPolite(entry: JournalEntry, scenarios: readonly ScenarioGraph[]): boolean {
  if (entry.choiceId === 'timeout') {
    return false;
  }
  if (entry.verdict !== 'best' && entry.verdict !== 'ok') {
    return false;
  }
  if (actionServiceSkill(scenarios, entry) > 0) {
    return true;
  }
  const scenario = scenarios.find((item) => item.id === entry.scenarioId);
  if (scenario?.competencies.includes('service')) {
    return true;
  }
  return entry.loyaltyDelta > 0;
}

function summaryOutcome(state: EngineState, scenarios: readonly ScenarioGraph[]): RunOutcome {
  if (state.outcome) {
    return state.outcome;
  }
  if (countIncidents(state, scenarios) > 0) {
    return 'incident';
  }
  return 'completed';
}

function reactionAvg(journal: readonly JournalEntry[]): number {
  let sum = 0;
  let count = 0;
  for (const entry of journal) {
    if (entry.reactionMs === null) {
      continue;
    }
    sum += entry.reactionMs;
    count += 1;
  }
  if (count === 0) {
    return 0;
  }
  return Math.round(sum / count);
}

function countPrevented(state: EngineState, scenarios: readonly ScenarioGraph[]): number {
  let count = 0;
  for (const entry of state.journal) {
    if (entry.verdict !== 'best') {
      continue;
    }
    const scenario = scenarios.find((item) => item.id === entry.scenarioId);
    if (scenario?.category === 'safety' || scenario?.category === 'technical') {
      count += 1;
    }
  }
  return count;
}

function countTagged(
  state: EngineState,
  scenarios: readonly ScenarioGraph[],
  flag: string,
): number {
  let count = 0;
  for (const entry of state.journal) {
    if (actionFlags(scenarios, entry).includes(flag)) {
      count += 1;
    }
  }
  const last = state.journal.length - 1;
  for (let index = 0; index < state.journal.length; index += 1) {
    if (skipUnfollowed(state, scenarios, index, last)) {
      continue;
    }
    const entry = state.journal[index];
    if (!entry) {
      continue;
    }
    const hit = followedEnd(scenarios, entry);
    if (hit && nodeTags(hit.node).includes(flag)) {
      count += 1;
    }
  }
  return count;
}
