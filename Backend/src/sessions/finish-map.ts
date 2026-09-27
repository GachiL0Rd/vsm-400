import { clampScale } from '../engine/scale';
import { politenessOf } from '../engine/summarize';
import type { RunSummary } from '../engine/types';

/**
 * Из FinishedGameResult в RunSummary идут только termination и scores.
 * userInputs и id ачивок игры в компетенциях Backend не участвуют.
 */
export type FinishAssessment = {
  termination: {
    kind: 'route-completed' | 'terminal-rule';
    outcomeId: string;
  };
  scores: {
    safety: number;
    customerSatisfaction: number;
  };
};

export function finishToSummary(result: FinishAssessment): RunSummary {
  const safety = roundedScore(result.scores.safety);
  const loyalty = roundedScore(result.scores.customerSatisfaction);
  const outcome = mapOutcome(result.termination);
  return {
    outcome,
    loyalty,
    safety,
    politeness: politenessOf(loyalty, [], []),
    timeouts: 0,
    reactionAvgMs: 0,
    competencyDelta: {},
    decisions: [],
    facts: {
      prevented: 0,
      incidents: outcome === 'incident' ? 1 : 0,
      complaints: 0,
      interventions: result.termination.outcomeId === 'route-safely-interrupted' ? 1 : 0,
    },
  };
}

function mapOutcome(termination: FinishAssessment['termination']): RunSummary['outcome'] {
  if (termination.kind === 'route-completed') {
    return 'completed';
  }
  if (termination.outcomeId === 'route-safely-interrupted') {
    return 'terminated';
  }
  return 'incident';
}

function roundedScore(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.round(clampScale(value));
}
