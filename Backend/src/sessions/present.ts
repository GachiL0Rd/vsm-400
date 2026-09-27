import type { EngineState } from '../engine';
import type { NextStep } from './compute-next';
import type { DecisionView, SessionView } from './dto';
import { isRecord } from './state-json';

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
