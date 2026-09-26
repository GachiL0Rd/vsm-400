import { conditionHolds } from './compare';
import { EngineError } from './errors';
import { PARAM_SCENARIO_TOTAL } from './params';
import { type DecisionNode, isEndNode, type ScenarioGraph } from './schema';
import type { EngineState, NodeProgress, NodeView } from './types';
import { hasAllFlags } from './walk';

/**
 * elapsedMs — миллисекунды, уже прошедшие на узле, не стенные часы и не HH:mm.
 * Дедлайн сессии снаружи: в EngineState его нет, поэтому без elapsedMs
 * отдаём таймер как в графе.
 */
export function view(state: EngineState, scenario: ScenarioGraph, elapsedMs?: number): NodeView {
  const node = scenario.nodes[state.nodeId];
  if (!node) {
    throw new EngineError('NODE_MISSING');
  }
  const finished = state.outcome !== null || isEndNode(node);
  const text = isEndNode(node) ? node.text : resolveText(node, state);
  const timerSec = finished || isEndNode(node) ? null : remainingTimer(node.timer, elapsedMs);
  const choices = finished || isEndNode(node) ? [] : visibleChoices(node, state);
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
