import { conditionHolds } from './compare';
import { EngineError } from './errors';
import { PARAM_SCENARIO_TOTAL } from './params';
import { type DecisionNode, isEndNode, type ScenarioGraph } from './schema';
import type { EngineState, NodeProgress, NodeView } from './types';

/**
 * now — миллисекунды, уже прошедшие на узле. Дедлайн сессии снаружи,
 * в EngineState его нет, поэтому без now отдаём таймер как в графе.
 */
export function view(state: EngineState, scenario: ScenarioGraph, now?: number): NodeView {
  const node = scenario.nodes[state.nodeId];
  if (!node) {
    throw new EngineError('NODE_MISSING');
  }
  const finished = state.outcome !== null || isEndNode(node);
  const text = isEndNode(node) ? node.text : resolveText(node, state);
  const timerSec = finished || isEndNode(node) ? null : remainingTimer(node.timer, now);
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
    if (required && !hasAll(state.flags, required)) {
      continue;
    }
    choices.push({ id: choice.id, text: choice.text });
  }
  return choices;
}

function hasAll(flags: readonly string[], required: readonly string[]): boolean {
  for (const flag of required) {
    if (!flags.includes(flag)) {
      return false;
    }
  }
  return true;
}

function remainingTimer(timer: number | null | undefined, now: number | undefined): number | null {
  if (timer == null) {
    return null;
  }
  if (now == null) {
    return timer;
  }
  const left = timer - now / 1000;
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
