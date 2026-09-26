import type { EngineState, ScenarioGraph } from '../engine';
import { view } from '../engine/view';
import type { NextStep } from './compute-next';
import type { DecisionView, SessionView } from './dto';
import { isRecord } from './state-json';

type Graph = ScenarioGraph;

export function presentView(input: {
  status: SessionView['status'];
  state: EngineState;
  shownAt: Date | null;
  deadline: Date | null;
  graph: Graph;
  now: Date;
}): SessionView {
  const elapsed = elapsedMs(input.shownAt, input.now);
  const nodeView = view(input.state, input.graph, elapsed);
  return {
    status: input.status,
    seq: input.state.seq,
    view: nodeView,
    scales: scalesOf(input.state),
    deadlineAt: input.deadline ? input.deadline.toISOString() : null,
    progress: nodeView.progress,
  };
}

export function decisionBody(status: SessionView['status'], next: NextStep): DecisionView {
  return {
    status,
    seq: next.seq,
    view: next.nodeView,
    scales: scalesOf(next.state),
    deadlineAt: next.deadline ? next.deadline.toISOString() : null,
    progress: next.nodeView.progress,
    applied: next.applied,
    finished: next.finished,
  };
}

export function readReplay(payload: unknown, choiceId: string): DecisionView | null {
  if (!isRecord(payload) || payload.choiceId !== choiceId || !isRecord(payload.response)) {
    return null;
  }
  const response = payload.response;
  if (typeof response.seq !== 'number' || typeof response.status !== 'string') {
    return null;
  }
  if (response.applied !== 'choice' && response.applied !== 'timeout') {
    return null;
  }
  return response as DecisionView;
}

function scalesOf(state: EngineState): SessionView['scales'] {
  return { loyalty: state.loyalty, safety: state.safety, politeness: state.politeness };
}

function elapsedMs(shownAt: Date | null, now: Date): number | undefined {
  if (!shownAt) {
    return undefined;
  }
  return Math.max(0, now.getTime() - shownAt.getTime());
}
