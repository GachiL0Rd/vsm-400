import { EngineError } from '../engine/errors';
import type { ScenarioGraph } from '../engine/schema';
import { step } from '../engine/step';
import { summarize } from '../engine/summarize';
import type { EngineState, NodeView, RunSummary, ShiftPlan, TextVariant } from '../engine/types';
import { view } from '../engine/view';
import { isPastDeadline, mergeFlags, reactionFlag, timingFlags } from './anti-cheat';
import type { StoredState } from './state-json';
import { attachShown, currentGraph, deadlineFor } from './state-json';

export type NextStep = {
  stored: StoredState;
  seq: number;
  deadline: Date | null;
  flags: string[];
  applied: 'choice' | 'timeout';
  finished: boolean;
  summary: RunSummary | null;
  nodeView: NodeView;
  state: EngineState;
};

export function computeNext(input: {
  state: EngineState;
  shownAt: Date | null;
  plan: ShiftPlan;
  graphs: readonly ScenarioGraph[];
  choiceId: string;
  deadline: Date | null;
  now: Date;
  flags: readonly string[];
  /** Перефраз узла, который игрок уже видит. Журнал пишет его тексты. */
  textVariant?: TextVariant;
}): NextStep {
  const graph = currentGraph(input.state, input.graphs);
  const nowMs = input.now.getTime();
  const late = isPastDeadline(input.deadline ? input.deadline.getTime() : null, nowMs);
  const applied = late ? 'timeout' : 'choice';
  const elapsed = input.shownAt ? Math.max(0, nowMs - input.shownAt.getTime()) : 0;
  const stepped = step(
    input.state,
    graph,
    applied === 'timeout' ? 'timeout' : { choiceId: input.choiceId },
    {
      elapsedMs: elapsed,
      plan: input.plan,
      scenarios: input.graphs,
      textVariant: input.textVariant,
    },
  );
  const timing = timingFlags({
    deadlineAt: input.deadline ? input.deadline.getTime() : null,
    now: nowMs,
    choiceId: input.choiceId,
  });
  const fast = reactionFlag(stepped.state.journal.map((entry) => entry.reactionMs));
  const extra = fast ? [fast, ...timing] : timing;
  const flags = mergeFlags(input.flags, extra);
  const nextGraph = currentGraph(stepped.state, input.graphs);
  const node = nextGraph.nodes[stepped.state.nodeId];
  if (!node) {
    throw new EngineError('NODE_MISSING');
  }
  const finished = stepped.state.outcome !== null;
  const deadline = finished ? null : deadlineFor(node, input.now);
  return {
    stored: attachShown(stepped.state, input.now),
    seq: stepped.state.seq,
    deadline,
    flags,
    applied,
    finished,
    summary: finished ? summarize(stepped.state, input.graphs) : null,
    nodeView: view(stepped.state, nextGraph, 0),
    state: stepped.state,
  };
}
