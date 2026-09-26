import { nextGameTime } from './clock';
import { asCompare, conditionHolds, type EffectsIf, numericHolds, readEffectsIf } from './compare';
import { EngineError } from './errors';
import { PARAM_NODE_STEP_MIN, takeParams } from './params';
import { clampScale } from './scale';
import {
  type Competency,
  type DecisionNode,
  isEndNode,
  type RunOutcome,
  type ScenarioGraph,
  type Verdict,
} from './schema';
import { addSkills, copySkills } from './skills';
import { politenessOf } from './summarize';
import type { EngineState, JournalEntry, ShiftPlan, StepInput } from './types';
import { resolveText } from './view';
import { countIncidents } from './walk';

export const TIMEOUT_ACTION = 'Нет решения — время вышло';

export type StepContext = {
  /** Сколько миллисекунд игрок думал. У timeout в журнал пишется null. */
  elapsedMs: number;
  /** Без плана финал сценария закрывает всю сессию. */
  plan?: ShiftPlan;
  /**
   * Графы плана. Нужны, чтобы перейти дальше и вспомнить incident-финал:
   * в EngineState нет отдельного поля «уже был срыв».
   */
  scenarios?: readonly ScenarioGraph[];
};

type RawAction = {
  choiceId: string;
  action: string;
  loyalty: number;
  safety: number;
  skills: Partial<Record<Competency, number>>;
  set: string[];
  verdict: Verdict;
  better: string | null;
  basis: string | null;
  consequence: string | null;
  deviation: boolean;
  lucky: boolean;
  next: string;
  effectsIf: EffectsIf[];
};

/**
 * Параметры уже лежат в плане: старт не крутит RNG, иначе скрытый счётчик
 * разъехался бы с генератором.
 */
export function createState(plan: ShiftPlan, scenarios: readonly ScenarioGraph[]): EngineState {
  const first = plan.scenarios[0];
  if (!first) {
    throw new EngineError('EMPTY_PLAN');
  }
  const scenario = scenarios.find((item) => item.id === first.scenarioId);
  if (!scenario) {
    throw new EngineError('SCENARIO_MISSING');
  }
  if (!scenario.nodes[scenario.start]) {
    throw new EngineError('NODE_MISSING');
  }
  const loyalty = scenario.init.loyalty;
  const safety = scenario.init.safety;
  return {
    scenarioIndex: 0,
    scenarioId: scenario.id,
    nodeId: scenario.start,
    loyalty,
    safety,
    politeness: politenessOf(loyalty, [], []),
    flags: [],
    skills: {},
    params: takeParams(first.params, plan.scenarios.length, undefined),
    seq: 0,
    timeouts: 0,
    journal: [],
    outcome: null,
  };
}

export function step(
  state: EngineState,
  scenario: ScenarioGraph,
  input: StepInput,
  ctx: StepContext,
): { state: EngineState; entry: JournalEntry } {
  const node = openNode(state, scenario);
  const action = resolveAction(node, input, state.flags);
  const extra = extraDeltas(action.effectsIf, state);
  const loyaltyDelta = action.loyalty + extra.loyalty;
  const safetyDelta = action.safety + extra.safety;
  const situation = resolveText(node, state);
  const draft = structuredClone(state);
  draft.loyalty = clampScale(draft.loyalty + loyaltyDelta);
  draft.safety = clampScale(draft.safety + safetyDelta);
  addSkills(draft.skills, action.skills);
  addSkills(draft.skills, extra.skills);
  addFlags(draft.flags, action.set);
  if (input === 'timeout') {
    draft.timeouts += 1;
  }
  const entry = makeEntry(
    draft,
    scenario,
    action,
    situation,
    loyaltyDelta,
    safetyDelta,
    ctx.elapsedMs,
  );
  draft.journal.push(entry);
  draft.seq = entry.idx + 1;
  draft.politeness = politenessOf(draft.loyalty, draft.journal, knownScenarios(scenario, ctx));
  if (gateTripped(scenario, draft)) {
    draft.outcome = 'terminated';
    return { state: draft, entry };
  }
  move(draft, scenario, action.next, ctx);
  return { state: draft, entry };
}

function openNode(state: EngineState, scenario: ScenarioGraph): DecisionNode {
  if (state.outcome !== null) {
    throw new EngineError('SESSION_FINISHED');
  }
  if (scenario.id !== state.scenarioId) {
    throw new EngineError('SCENARIO_MISSING');
  }
  const node = scenario.nodes[state.nodeId];
  if (!node) {
    throw new EngineError('NODE_MISSING');
  }
  if (isEndNode(node)) {
    throw new EngineError('SESSION_FINISHED');
  }
  return node;
}

function resolveAction(node: DecisionNode, input: StepInput, flags: readonly string[]): RawAction {
  if (input === 'timeout') {
    return timeoutAction(node);
  }
  return choiceAction(node, input.choiceId, flags);
}

function choiceAction(node: DecisionNode, choiceId: string, flags: readonly string[]): RawAction {
  const choice = node.choices.find((item) => item.id === choiceId);
  if (!choice) {
    throw new EngineError('UNKNOWN_CHOICE');
  }
  const required = choice.requires?.flags;
  if (required && !hasAllFlags(flags, required)) {
    throw new EngineError('CHOICE_NOT_AVAILABLE');
  }
  return {
    choiceId: choice.id,
    action: choice.text,
    loyalty: choice.effects?.loyalty ?? 0,
    safety: choice.effects?.safety ?? 0,
    skills: copySkills(choice.skills),
    set: choice.set ? choice.set.slice() : [],
    verdict: choice.verdict ?? 'ok',
    better: choice.better ?? null,
    basis: choice.basis ?? null,
    consequence: readOptionalString(choice, 'consequence'),
    deviation: choice.deviation ?? false,
    lucky: readFlagBool(choice, 'lucky'),
    next: choice.next,
    effectsIf: readEffectsIf(choice),
  };
}

function timeoutAction(node: DecisionNode): RawAction {
  const timeout = node.onTimeout;
  if (!timeout) {
    throw new EngineError('TIMEOUT_UNHANDLED');
  }
  return {
    choiceId: 'timeout',
    action: TIMEOUT_ACTION,
    loyalty: timeout.effects?.loyalty ?? 0,
    safety: timeout.effects?.safety ?? 0,
    skills: {},
    set: timeout.set ? timeout.set.slice() : [],
    verdict: timeout.verdict ?? 'missed',
    better: readOptionalString(timeout, 'better'),
    basis: readOptionalString(timeout, 'basis'),
    consequence: timeout.consequence ?? null,
    deviation: readFlagBool(timeout, 'deviation'),
    lucky: readFlagBool(timeout, 'lucky'),
    next: timeout.next,
    effectsIf: readEffectsIf(timeout),
  };
}

function extraDeltas(
  branches: readonly EffectsIf[],
  state: EngineState,
): { loyalty: number; safety: number; skills: Partial<Record<Competency, number>> } {
  let loyalty = 0;
  let safety = 0;
  const skills: Partial<Record<Competency, number>> = {};
  for (const branch of branches) {
    if (!conditionHolds(branch.if, state)) {
      continue;
    }
    loyalty += branch.effects?.loyalty ?? 0;
    safety += branch.effects?.safety ?? 0;
    addSkills(skills, branch.skills);
  }
  return { loyalty, safety, skills };
}

function makeEntry(
  draft: EngineState,
  scenario: ScenarioGraph,
  action: RawAction,
  situation: string,
  loyaltyDelta: number,
  safetyDelta: number,
  elapsedMs: number,
): JournalEntry {
  return {
    idx: draft.journal.length,
    gameTime: nextGameTime(draft),
    stage: scenario.stage,
    scenarioId: scenario.id,
    nodeId: draft.nodeId,
    choiceId: action.choiceId,
    situation,
    action: action.action,
    verdict: action.verdict,
    loyaltyDelta,
    safetyDelta,
    reactionMs: action.choiceId === 'timeout' ? null : elapsedMs,
    consequence: action.consequence,
    lucky: action.lucky,
    better: action.better,
    basis: action.basis,
    deviation: action.deviation,
  };
}

function gateTripped(scenario: ScenarioGraph, state: EngineState): boolean {
  const failIf = scenario.gates?.failIf;
  if (!failIf) {
    return false;
  }
  if (failIf.safety && numericHolds(asCompare(failIf.safety), state.safety)) {
    return true;
  }
  return Boolean(failIf.loyalty && numericHolds(asCompare(failIf.loyalty), state.loyalty));
}

function move(draft: EngineState, scenario: ScenarioGraph, nextId: string, ctx: StepContext): void {
  const next = scenario.nodes[nextId];
  if (!next) {
    throw new EngineError('NODE_MISSING');
  }
  if (!isEndNode(next)) {
    draft.nodeId = nextId;
    return;
  }
  if (next.end === 'terminated' || !hasNextScenario(draft, ctx.plan)) {
    draft.nodeId = nextId;
    draft.outcome = aggregateOutcome(draft, scenario, ctx, next.end);
    return;
  }
  advance(draft, ctx);
}

function hasNextScenario(draft: EngineState, plan: ShiftPlan | undefined): boolean {
  if (!plan) {
    return false;
  }
  return draft.scenarioIndex + 1 < plan.scenarios.length;
}

function aggregateOutcome(
  draft: EngineState,
  scenario: ScenarioGraph,
  ctx: StepContext,
  end: RunOutcome,
): RunOutcome {
  if (end === 'terminated') {
    return 'terminated';
  }
  if (end === 'incident') {
    return 'incident';
  }
  if (countIncidents(draft, knownScenarios(scenario, ctx)) > 0) {
    return 'incident';
  }
  return 'completed';
}

function advance(draft: EngineState, ctx: StepContext): void {
  const plan = ctx.plan;
  const planned = plan?.scenarios[draft.scenarioIndex + 1];
  const graphs = ctx.scenarios;
  if (!plan || !planned || !graphs) {
    throw new EngineError('SCENARIO_MISSING');
  }
  const nextGraph = graphs.find((item) => item.id === planned.scenarioId);
  if (!nextGraph?.nodes[nextGraph.start]) {
    throw new EngineError(nextGraph ? 'NODE_MISSING' : 'SCENARIO_MISSING');
  }
  const inherited = draft.params[PARAM_NODE_STEP_MIN];
  // Шкалы, флаги и навыки живут на всей смене: init следующего сценария их не сбрасывает.
  draft.scenarioIndex += 1;
  draft.scenarioId = nextGraph.id;
  draft.nodeId = nextGraph.start;
  draft.params = takeParams(planned.params, plan.scenarios.length, inherited);
  draft.outcome = null;
}

function knownScenarios(current: ScenarioGraph, ctx: StepContext): ScenarioGraph[] {
  const list: ScenarioGraph[] = [];
  for (const item of ctx.scenarios ?? []) {
    list.push(item);
  }
  if (!list.some((item) => item.id === current.id)) {
    list.push(current);
  }
  return list;
}

function addFlags(flags: string[], set: readonly string[]): void {
  for (const flag of set) {
    if (!flags.includes(flag)) {
      flags.push(flag);
    }
  }
}

function hasAllFlags(flags: readonly string[], required: readonly string[]): boolean {
  for (const flag of required) {
    if (!flags.includes(flag)) {
      return false;
    }
  }
  return true;
}

function readOptionalString(source: object, key: string): string | null {
  const value = (source as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
}

function readFlagBool(source: object, key: string): boolean {
  return (source as Record<string, unknown>)[key] === true;
}
