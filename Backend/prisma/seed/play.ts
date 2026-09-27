import type { RunView } from '../../src/achievements/interpret';
import { generateShift } from '../../src/engine/generator';
import { createRng, type Rng } from '../../src/engine/rng';
import { isEndNode, type ScenarioGraph, type Verdict } from '../../src/engine/schema';
import { createState, step } from '../../src/engine/step';
import { summarize } from '../../src/engine/summarize';
import type { EngineState, RunSummary, ShiftPlan, StepInput } from '../../src/engine/types';
import { view } from '../../src/engine/view';
import { computePoints } from '../../src/progression/scoring';
import type { PlayContext } from './content';

const VERDICTS = ['best', 'ok', 'worse', 'missed'] as const;

const WEIGHT = {
  best: { base: 0.35, skill: 9 },
  ok: { base: 1.4, skill: 1.2 },
  worse: { base: 4, skill: -3.4 },
  missed: { base: 2.2, skill: -1.8 },
} as const;

export type SimulatedRun = {
  seed: Buffer;
  plan: ShiftPlan;
  state: EngineState;
  summary: RunSummary;
  points: number;
  view: RunView;
  finishedAt: Date;
};

export function simulateRun(
  seed: Buffer,
  skill: number,
  finishedAt: Date,
  ctx: PlayContext,
): SimulatedRun {
  const rng = createRng(seed);
  const count = rng.int(3, 5);
  const plan = generateShift(rng, ctx.catalog, { count }, ctx.routes);
  const state = playOut(rng, plan, ctx.graphs, skill);
  const summary = summarize(state, ctx.graphs);
  const points = computePoints(summary, hardest(plan, ctx.graphs), ctx.scoring);
  return {
    seed,
    plan,
    state,
    summary,
    points,
    view: toView(summary, ctx.graphs),
    finishedAt,
  };
}

function playOut(
  rng: Rng,
  plan: ShiftPlan,
  graphs: readonly ScenarioGraph[],
  skill: number,
): EngineState {
  let state = createState(plan, graphs);
  for (let guard = 0; guard < 48 && state.outcome === null; guard += 1) {
    const scenario = graphs.find((item) => item.id === state.scenarioId);
    if (!scenario) {
      throw new Error(`Нет графа ${state.scenarioId}`);
    }
    const node = scenario.nodes[state.nodeId];
    if (!node || isEndNode(node)) {
      break;
    }
    const input = chooseInput(rng, scenario, state, skill);
    const elapsedMs = reactionMs(rng, node.timer, skill, input);
    state = applyStep(state, scenario, input, elapsedMs, plan, graphs);
  }
  if (state.outcome === null) {
    throw new Error(`Смена не дошла до финала: ${state.scenarioId}/${state.nodeId}`);
  }
  return state;
}

function applyStep(
  state: EngineState,
  scenario: ScenarioGraph,
  input: StepInput,
  elapsedMs: number,
  plan: ShiftPlan,
  graphs: readonly ScenarioGraph[],
): EngineState {
  try {
    return step(state, scenario, input, { elapsedMs, plan, scenarios: graphs }).state;
  } catch (error) {
    if (input === 'timeout') {
      throw error;
    }
    return step(state, scenario, 'timeout', { elapsedMs: 0, plan, scenarios: graphs }).state;
  }
}

function chooseInput(
  rng: Rng,
  scenario: ScenarioGraph,
  state: EngineState,
  skill: number,
): StepInput {
  const node = scenario.nodes[state.nodeId];
  if (!node || isEndNode(node)) {
    return 'timeout';
  }
  const shown = view(state, scenario).choices;
  if (shown.length === 0 || (node.onTimeout && rng.nextFloat() < (1 - skill) * 0.22)) {
    return 'timeout';
  }
  const weighted = shown.map((choice) => ({
    id: choice.id,
    weight: choiceWeight(verdictOf(node, choice.id), skill),
  }));
  return { choiceId: pickWeighted(rng, weighted) };
}

function verdictOf(
  node: { choices: readonly { id: string; verdict?: Verdict }[] },
  id: string,
): Verdict {
  const choice = node.choices.find((item) => item.id === id);
  const verdict = choice?.verdict;
  if (verdict && isVerdict(verdict)) {
    return verdict;
  }
  return 'ok';
}

function isVerdict(value: string): value is Verdict {
  return (VERDICTS as readonly string[]).includes(value);
}

function choiceWeight(verdict: Verdict, skill: number): number {
  const row = WEIGHT[verdict];
  return Math.max(0.05, row.base + skill * row.skill);
}

function pickWeighted(rng: Rng, items: readonly { id: string; weight: number }[]): string {
  let total = 0;
  for (const item of items) {
    total += item.weight;
  }
  let cursor = rng.nextFloat() * total;
  for (const item of items) {
    cursor -= item.weight;
    if (cursor <= 0) {
      return item.id;
    }
  }
  const last = items[items.length - 1];
  if (!last) {
    throw new Error('Нет доступного выбора');
  }
  return last.id;
}

function reactionMs(
  rng: Rng,
  timerSec: number | null | undefined,
  skill: number,
  input: StepInput,
): number {
  if (input === 'timeout') {
    return 0;
  }
  const timer = (timerSec ?? 30) * 1000;
  const fraction = 0.12 + (1 - skill) * 0.75 * rng.nextFloat();
  return Math.max(200, Math.round(Math.min(0.95, fraction) * timer));
}

function hardest(plan: ShiftPlan, graphs: readonly ScenarioGraph[]): 1 | 2 | 3 {
  let value = 1;
  for (const item of plan.scenarios) {
    const graph = graphs.find((entry) => entry.id === item.scenarioId);
    value = Math.max(value, graph?.difficulty ?? 1);
  }
  if (value >= 3) {
    return 3;
  }
  if (value <= 1) {
    return 1;
  }
  return 2;
}

function scale(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(100, Math.max(0, Math.round(value)));
}

function toView(summary: RunSummary, graphs: readonly ScenarioGraph[]): RunView {
  const categories = new Map(graphs.map((graph) => [graph.id, graph.category]));
  let timeouts = 0;
  const decisions = summary.decisions.map((decision) => {
    if (decision.choiceId === 'timeout') {
      timeouts += 1;
    }
    return {
      idx: decision.idx,
      stage: decision.stage,
      scenarioId: decision.scenarioId,
      category: categories.get(decision.scenarioId) ?? null,
      choiceId: decision.choiceId,
      situation: decision.situation,
      verdict: decision.verdict,
      reactionMs: decision.reactionMs,
      timerSec: decision.timerSec,
      safetyDelta: decision.safetyDelta,
      loyaltyDelta: decision.loyaltyDelta,
      lucky: decision.lucky,
      deviation: decision.deviation,
    };
  });
  return {
    outcome: summary.outcome,
    safety: scale(summary.safety),
    loyalty: scale(summary.loyalty),
    suspicious: false,
    timeouts,
    facts: {
      prevented: summary.facts.prevented,
      incidents: summary.facts.incidents,
      complaints: summary.facts.complaints,
      interventions: summary.facts.interventions,
    },
    decisions,
  };
}
