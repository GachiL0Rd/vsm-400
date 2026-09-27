import { conditionHolds } from './compare';
import { EngineError } from './errors';
import { PARAM_SCENARIO_TOTAL } from './params';
import type { Rng } from './rng';
import { type DecisionNode, isEndNode, type ScenarioGraph } from './schema';
import { applyTextVariant, orderChoices } from './text';
import type { EngineState, NodeProgress, NodeView, TextVariant } from './types';
import { hasAllFlags } from './walk';

/**
 * textVariant — перефраз текущего узла. rng — порядок видимых выборов.
 * Для повторного GET сессия передаёт fork, а не общий поток: shuffle двигает счётчик.
 */
export type ViewOptions = {
  textVariant?: TextVariant;
  rng?: Rng;
};

/**
 * elapsedMs — миллисекунды, уже прошедшие на узле, не стенные часы и не HH:mm.
 * Дедлайн сессии снаружи: в EngineState его нет, поэтому без elapsedMs
 * отдаём таймер как в графе.
 */
export function view(
  state: EngineState,
  scenario: ScenarioGraph,
  elapsedMs?: number,
  options?: ViewOptions,
): NodeView {
  const raw = scenario.nodes[state.nodeId];
  if (!raw) {
    throw new EngineError('NODE_MISSING');
  }
  const node = applyTextVariant(raw, options?.textVariant);
  const finished = state.outcome !== null || isEndNode(node);
  const text = isEndNode(node) ? node.text : resolveText(node, state);
  const timerSec = finished || isEndNode(node) ? null : remainingTimer(node.timer, elapsedMs);
  const listed = finished || isEndNode(node) ? [] : visibleChoices(node, state);
  const choices = options?.rng ? orderChoices(listed, options.rng) : listed;
  return {
    nodeId: state.nodeId,
    text,
    timerSec,
    choices,
    loyalty: state.loyalty,
    safety: state.safety,
    seq: state.seq,
    finished,
    progress: progressOf(state),
  };
}

export function resolveText(
  node: DecisionNode,
  state: Pick<EngineState, 'flags' | 'params'>,
): string {
  for (const variant of node.variants ?? []) {
    if (conditionHolds(variant.if, state)) {
      return variant.text;
    }
  }
  return node.text;
}

function visibleChoices(node: DecisionNode, state: EngineState): { id: string; text: string }[] {
  const choices: { id: string; text: string }[] = [];
  for (const choice of node.choices) {
    const required = choice.requires?.flags;
    if (required && !hasAllFlags(state.flags, required)) {
      continue;
    }
    choices.push({ id: choice.id, text: choice.text });
  }
  return choices;
}

function remainingTimer(
  timer: number | null | undefined,
  elapsedMs: number | undefined,
): number | null {
  if (timer == null) {
    return null;
  }
  if (elapsedMs == null) {
    return timer;
  }
  const left = timer - elapsedMs / 1000;
  if (left <= 0) {
    return 0;
  }
  return Math.ceil(left);
}

function progressOf(state: EngineState): NodeProgress {
  const total = state.params[PARAM_SCENARIO_TOTAL];
  const safeTotal = total !== undefined && total >= 1 ? total : state.scenarioIndex + 1;
  return { index: state.scenarioIndex + 1, total: safeTotal };
}
