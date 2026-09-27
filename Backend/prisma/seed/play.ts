import type { RunView } from '../../src/achievements/interpret';
import { generateShift } from '../../src/engine/generator';
import { createRng, type Rng } from '../../src/engine/rng';
import {
  type Competency,
  isEndNode,
  type RunOutcome,
  type ScenarioGraph,
  type ScenarioNode,
  type Verdict,
} from '../../src/engine/schema';
import { politenessOf } from '../../src/engine/summarize';
import type { JournalEntry, RunSummary, ShiftPlan } from '../../src/engine/types';
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
  seq: number;
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
  const summary = buildSummary(rng, plan, ctx.graphs, skill);
  const points = computePoints(summary, hardest(plan, ctx.graphs), ctx.scoring);
  return {
    seed,
    plan,
    seq: summary.decisions.length,
    summary,
    points,
    view: toView(summary, ctx.graphs),
    finishedAt,
  };
}

const DELTA = {
  best: { safety: 4, loyalty: 3 },
  ok: { safety: 1, loyalty: 1 },
  worse: { safety: -6, loyalty: -4 },
  missed: { safety: -8, loyalty: -5 },
} as const;

const SKILL_DELTA = {
  best: 2,
  ok: 1,
  worse: -1,
  missed: -2,
} as const;

function clockOf(minute: number): string {
  const wrapped = ((minute % (24 * 60)) + 24 * 60) % (24 * 60);
  const hours = Math.floor(wrapped / 60);
  const mins = wrapped % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

type Walk = {
  loyalty: number;
  safety: number;
  minute: number;
  timeouts: number;
  worse: number;
  best: number;
  skills: Partial<Record<Competency, number>>;
  decisions: JournalEntry[];
};

function buildSummary(
  rng: Rng,
  plan: ShiftPlan,
  graphs: readonly ScenarioGraph[],
  skill: number,
): RunSummary {
  const walk = emptyWalk();
  for (const item of plan.scenarios) {
    const graph = graphs.find((entry) => entry.id === item.scenarioId);
    if (!graph) {
      throw new Error(`Нет графа ${item.scenarioId}`);
    }
    if (walkScenario(rng, graph, skill, walk)) {
      return finish(walk, 'terminated', graphs);
    }
  }
  const outcome: RunOutcome = walk.worse > walk.best ? 'incident' : 'completed';
  return finish(walk, outcome, graphs);
}

function emptyWalk(): Walk {
  return {
    loyalty: 72,
    safety: 72,
    minute: 6 * 60 + 20,
    timeouts: 0,
    worse: 0,
    best: 0,
    skills: {},
    decisions: [],
  };
}

function walkScenario(rng: Rng, graph: ScenarioGraph, skill: number, walk: Walk): boolean {
  let nodeId: string | null = graph.start;
  for (let guard = 0; guard < 8 && nodeId !== null; guard += 1) {
    const step = recordNode(rng, graph, nodeId, skill, walk);
    if (step.fail) {
      return true;
    }
    nodeId = step.next;
  }
  return false;
}

function recordNode(
  rng: Rng,
  graph: ScenarioGraph,
  nodeId: string,
  skill: number,
  walk: Walk,
): { fail: boolean; next: string | null } {
  const node: ScenarioNode | undefined = graph.nodes[nodeId];
  if (!node || isEndNode(node)) {
    return { fail: false, next: null };
  }
  const choice = selectChoice(rng, node, skill);
  pushDecision(rng, graph, node, nodeId, choice, skill, walk);
  if (walk.safety < 30) {
    return { fail: true, next: null };
  }
  return { fail: false, next: choice ? choice.next : (node.onTimeout?.next ?? null) };
}

function selectChoice(rng: Rng, node: Extract<ScenarioNode, { choices: unknown }>, skill: number) {
  const timedOut = node.onTimeout !== undefined && rng.nextFloat() < (1 - skill) * 0.22;
  if (timedOut) {
    return null;
  }
  const picked = pickChoice(rng, node.choices, skill);
  for (const item of node.choices) {
    if (item.id === picked) {
      return item;
    }
  }
  return null;
}

function pushDecision(
  rng: Rng,
  graph: ScenarioGraph,
  node: Extract<ScenarioNode, { choices: unknown }>,
  nodeId: string,
  choice: ReturnType<typeof selectChoice>,
  skill: number,
  walk: Walk,
): void {
  const verdict: Verdict = choice ? verdictOf(node, choice.id) : 'missed';
  const shift = DELTA[verdict];
  walk.loyalty = scale(walk.loyalty + shift.loyalty);
  walk.safety = scale(walk.safety + shift.safety);
  countVerdict(walk, verdict);
  addSkills(walk.skills, graph.competencies, SKILL_DELTA[verdict]);
  const timerSec = typeof node.timer === 'number' ? node.timer : null;
  walk.decisions.push(
    toEntry(walk, graph, node, nodeId, choice, verdict, shift, timerSec, rng, skill),
  );
  walk.minute += 5;
}

function countVerdict(walk: Walk, verdict: Verdict): void {
  if (verdict === 'best') {
    walk.best += 1;
  }
  if (verdict === 'worse' || verdict === 'missed') {
    walk.worse += 1;
  }
  if (verdict === 'missed') {
    walk.timeouts += 1;
  }
}

function toEntry(
  walk: Walk,
  graph: ScenarioGraph,
  node: Extract<ScenarioNode, { text: string }>,
  nodeId: string,
  choice: {
    id: string;
    text: string;
    consequence?: string;
    lucky?: boolean;
    better?: string;
    basis?: string;
    deviation?: boolean;
  } | null,
  verdict: Verdict,
  shift: { safety: number; loyalty: number },
  timerSec: number | null,
  rng: Rng,
  skill: number,
): JournalEntry {
  return {
    idx: walk.decisions.length,
    gameTime: clockOf(walk.minute),
    stage: graph.stage,
    scenarioId: graph.id,
    nodeId,
    choiceId: choice?.id ?? 'timeout',
    situation: node.text,
    action: choice?.text ?? 'Нет решения — время вышло',
    verdict,
    loyaltyDelta: shift.loyalty,
    safetyDelta: shift.safety,
    reactionMs: reactionMs(rng, timerSec, skill, choice === null),
    timerSec,
    consequence: choice?.consequence ?? null,
    lucky: choice?.lucky ?? false,
    better: choice?.better ?? null,
    basis: choice?.basis ?? null,
    deviation: choice?.deviation ?? false,
  };
}

function finish(walk: Walk, outcome: RunOutcome, graphs: readonly ScenarioGraph[]): RunSummary {
  const facts = tally(walk.decisions, graphs);
  return {
    outcome,
    loyalty: walk.loyalty,
    safety: walk.safety,
    politeness: politenessOf(walk.loyalty, walk.decisions, graphs),
    timeouts: walk.timeouts,
    reactionAvgMs: facts.reactionAvgMs,
    competencyDelta: walk.skills,
    decisions: walk.decisions,
    facts: {
      prevented: facts.prevented,
      incidents: outcome === 'incident' ? 1 : 0,
      complaints: facts.complaints,
      interventions: facts.interventions,
    },
  };
}

function tally(decisions: readonly JournalEntry[], graphs: readonly ScenarioGraph[]) {
  let reactionSum = 0;
  let reactionCount = 0;
  let prevented = 0;
  let complaints = 0;
  let interventions = 0;
  for (const decision of decisions) {
    const bucket = factBucket(decision, graphs);
    reactionSum += bucket.reaction;
    reactionCount += bucket.reaction > 0 ? 1 : 0;
    prevented += bucket.prevented;
    complaints += bucket.complaints;
    interventions += bucket.interventions;
  }
  return {
    prevented,
    complaints,
    interventions,
    reactionAvgMs: reactionCount === 0 ? 0 : Math.round(reactionSum / reactionCount),
  };
}

function factBucket(decision: JournalEntry, graphs: readonly ScenarioGraph[]) {
  const graph = graphs.find((item) => item.id === decision.scenarioId);
  const reaction =
    decision.reactionMs !== null && decision.choiceId !== 'timeout' ? decision.reactionMs : 0;
  return {
    reaction,
    prevented:
      graph && decision.verdict === 'best' && graph.competencies.includes('safety') ? 1 : 0,
    complaints:
      graph && decision.verdict === 'worse' && graph.competencies.includes('service') ? 1 : 0,
    interventions:
      graph && decision.verdict === 'best' && graph.competencies.includes('escalation') ? 1 : 0,
  };
}

function addSkills(
  skills: Partial<Record<Competency, number>>,
  competencies: readonly Competency[],
  delta: number,
): void {
  for (const competency of competencies) {
    skills[competency] = (skills[competency] ?? 0) + delta;
  }
}

function pickChoice(
  rng: Rng,
  choices: readonly { id: string; verdict?: Verdict }[],
  skill: number,
): string {
  const weighted = choices.map((choice) => ({
    id: choice.id,
    weight: choiceWeight(verdictOf({ choices }, choice.id), skill),
  }));
  return pickWeighted(rng, weighted);
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
  timerSec: number | null,
  skill: number,
  missed: boolean,
): number | null {
  if (missed) {
    return null;
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
