import type { Competency, Stage, Verdict } from '../engine/schema';
import { COMPETENCY_IDS } from './competencies';

export type TaggedDecision = {
  runId: string;
  stage: Stage;
  verdict: Verdict;
  competencies: Competency[];
  reactionMs: number | null;
  lucky: boolean;
};

type ChoiceLike = {
  id?: string;
  skills?: Partial<Record<string, unknown>>;
};

/**
 * Узел относится к компетенции, если у сделанного выбора в графе есть skills
 * этой компетенции. Нет графа или выбора — берём competencies сценария.
 * timeout skills не имеет, поэтому остаётся на сценарии.
 */
export type RawDecision = {
  runId: string;
  stage: Stage;
  verdict: Verdict;
  scenarioId: string;
  nodeId: string;
  choiceId: string;
  reactionMs: number | null;
  lucky: boolean;
};

export function tagDecisions(
  rows: readonly RawDecision[],
  index: ReadonlyMap<string, { competencies: readonly Competency[]; graph: unknown }>,
): TaggedDecision[] {
  const tagged: TaggedDecision[] = [];
  for (const row of rows) {
    const scenario = index.get(row.scenarioId);
    tagged.push({
      runId: row.runId,
      stage: row.stage,
      verdict: row.verdict,
      reactionMs: row.reactionMs,
      lucky: row.lucky,
      competencies: decisionCompetencies(
        scenario?.competencies ?? [],
        scenario?.graph,
        row.nodeId,
        row.choiceId,
      ),
    });
  }
  return tagged;
}

export function decisionCompetencies(
  scenarioCompetencies: readonly Competency[],
  graph: unknown,
  nodeId: string,
  choiceId: string,
): Competency[] {
  const fromChoice = choiceSkills(graph, nodeId, choiceId);
  if (fromChoice && fromChoice.length > 0) {
    return fromChoice;
  }
  return [...scenarioCompetencies];
}

function choiceSkills(graph: unknown, nodeId: string, choiceId: string): Competency[] | null {
  if (choiceId === 'timeout') {
    return null;
  }
  const choice = readChoices(graph, nodeId)?.find((item) => item.id === choiceId);
  if (!choice?.skills) {
    return null;
  }
  const tagged: Competency[] = [];
  for (const id of COMPETENCY_IDS) {
    if (typeof choice.skills[id] === 'number') {
      tagged.push(id);
    }
  }
  return tagged;
}

function readChoices(graph: unknown, nodeId: string): ChoiceLike[] | null {
  if (!graph || typeof graph !== 'object') {
    return null;
  }
  const nodes = (graph as { nodes?: unknown }).nodes;
  if (!nodes || typeof nodes !== 'object') {
    return null;
  }
  const node = (nodes as Record<string, unknown>)[nodeId];
  if (!node || typeof node !== 'object') {
    return null;
  }
  const choices = (node as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) {
    return null;
  }
  return choices.filter((item): item is ChoiceLike => !!item && typeof item === 'object');
}
