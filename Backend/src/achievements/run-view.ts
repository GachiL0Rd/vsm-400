import type { RunOutcome } from '../engine/schema';
import { ScenarioCategorySchema } from '../engine/schema';
import type { DecisionView, RunFacts, RunView } from './interpret';

const EMPTY_FACTS: RunFacts = {
  prevented: 0,
  incidents: 0,
  complaints: 0,
  interventions: 0,
};

function readFacts(value: unknown): RunFacts {
  if (typeof value !== 'object' || value === null) {
    return EMPTY_FACTS;
  }
  const record = value as Record<string, unknown>;
  return {
    prevented: numberOrZero(record.prevented),
    incidents: numberOrZero(record.incidents),
    complaints: numberOrZero(record.complaints),
    interventions: numberOrZero(record.interventions),
  };
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

type StoredDecision = {
  idx: number;
  stage: DecisionView['stage'];
  scenarioId: string;
  choiceId: string;
  situation: string;
  verdict: DecisionView['verdict'];
  reactionMs: number | null;
  safetyDelta: number;
  loyaltyDelta: number;
  lucky: boolean;
  deviation: boolean;
};

type StoredRun = {
  outcome: RunOutcome;
  safety: number;
  loyalty: number;
  suspicious: boolean;
  facts: unknown;
  decisions: StoredDecision[];
};

export function toRunView(run: StoredRun, categories: ReadonlyMap<string, string>): RunView {
  const decisions: DecisionView[] = [];
  let timeouts = 0;
  for (const decision of run.decisions) {
    if (decision.choiceId === 'timeout') {
      timeouts += 1;
    }
    const rawCategory = categories.get(decision.scenarioId);
    const parsed = ScenarioCategorySchema.safeParse(rawCategory);
    decisions.push({
      idx: decision.idx,
      stage: decision.stage,
      scenarioId: decision.scenarioId,
      category: parsed.success ? parsed.data : null,
      choiceId: decision.choiceId,
      situation: decision.situation,
      verdict: decision.verdict,
      reactionMs: decision.reactionMs,
      safetyDelta: decision.safetyDelta,
      loyaltyDelta: decision.loyaltyDelta,
      lucky: decision.lucky,
      deviation: decision.deviation,
    });
  }
  return {
    outcome: run.outcome,
    safety: run.safety,
    loyalty: run.loyalty,
    suspicious: run.suspicious,
    timeouts,
    facts: readFacts(run.facts),
    decisions,
  };
}
