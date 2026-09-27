import { z } from 'zod';
import type { CarClass, Competency, RunOutcome, Stage, Verdict } from '../engine/schema';
import { COMPETENCY_IDS } from './competencies';
import { carClassLabel } from './forecast';

const DeltaSchema = z.object({
  safety: z.number().optional(),
  procedure: z.number().optional(),
  detection: z.number().optional(),
  reaction: z.number().optional(),
  service: z.number().optional(),
  escalation: z.number().optional(),
});

const FactsSchema = z.object({
  prevented: z.number().optional(),
  incidents: z.number().optional(),
  complaints: z.number().optional(),
  interventions: z.number().optional(),
});

export type RunRow = {
  id: string;
  train: string;
  route: string;
  car: number;
  carClass: CarClass;
  finishedAt: Date;
  playSeconds: number;
  outcome: RunOutcome;
  outcomeNote: string;
  loyalty: number;
  safety: number;
  points: number;
  competencyDelta: unknown;
  facts: unknown;
};

export type DecisionRow = {
  id: string;
  gameTime: string;
  stage: Stage;
  situation: string;
  action: string;
  verdict: Verdict;
  loyaltyDelta: number;
  safetyDelta: number;
  reactionMs: number | null;
  consequence: string | null;
  lucky: boolean;
  better: string | null;
  basis: string | null;
};

export type RunFacts = {
  prevented: number;
  incidents: number;
  complaints: number;
  interventions: number;
};

export type RunBrief = {
  id: string;
  train: string;
  route: string;
  car: number;
  carClass: string;
  finishedAt: string;
  playMinutes: number;
  outcome: RunOutcome;
  outcomeNote: string;
  loyalty: number;
  safety: number;
  points: number;
  competencyDelta: Partial<Record<Competency, number>>;
  facts: RunFacts;
};

export type DecisionView = {
  id: string;
  time: string;
  stage: Stage;
  situation: string;
  action: string;
  verdict: Verdict;
  loyalty: number;
  safety: number;
  reactionSec?: number;
  consequence?: string;
  lucky?: true;
  better?: string;
  basis?: string;
};

export function readDelta(value: unknown): Partial<Record<Competency, number>> {
  const parsed = DeltaSchema.safeParse(value ?? {});
  if (!parsed.success) {
    return {};
  }
  const delta: Partial<Record<Competency, number>> = {};
  for (const id of COMPETENCY_IDS) {
    const score = parsed.data[id];
    if (typeof score === 'number' && Number.isFinite(score)) {
      delta[id] = score;
    }
  }
  return delta;
}

export function readFacts(value: unknown): RunFacts {
  const parsed = FactsSchema.safeParse(value ?? {});
  const data = parsed.success ? parsed.data : {};
  return {
    prevented: whole(data.prevented),
    incidents: whole(data.incidents),
    complaints: whole(data.complaints),
    interventions: whole(data.interventions),
  };
}

export function presentRun(run: RunRow): RunBrief {
  return {
    id: run.id,
    train: run.train,
    route: run.route,
    car: run.car,
    carClass: carClassLabel(run.carClass),
    finishedAt: run.finishedAt.toISOString(),
    playMinutes: Math.round(run.playSeconds / 60),
    outcome: run.outcome,
    outcomeNote: run.outcomeNote,
    loyalty: run.loyalty,
    safety: run.safety,
    points: run.points,
    competencyDelta: readDelta(run.competencyDelta),
    facts: readFacts(run.facts),
  };
}

export function presentDecision(row: DecisionRow): DecisionView {
  const decision: DecisionView = {
    id: row.id,
    time: row.gameTime,
    stage: row.stage,
    situation: row.situation,
    action: row.action,
    verdict: row.verdict,
    loyalty: row.loyaltyDelta,
    safety: row.safetyDelta,
  };
  if (row.reactionMs !== null) {
    decision.reactionSec = Math.round(row.reactionMs / 100) / 10;
  }
  if (row.consequence) {
    decision.consequence = row.consequence;
  }
  if (row.lucky) {
    decision.lucky = true;
  }
  if (row.better) {
    decision.better = row.better;
  }
  if (row.basis) {
    decision.basis = row.basis;
  }
  return decision;
}

function whole(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }
  return Math.round(value);
}
