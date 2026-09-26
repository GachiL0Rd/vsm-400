import { type EndNode, isEndNode, type RunOutcome, type ScenarioGraph } from './schema';
import type { EngineState, JournalEntry } from './types';

export function actionFlags(
  scenarios: readonly ScenarioGraph[],
  entry: JournalEntry,
): readonly string[] {
  const scenario = scenarios.find((item) => item.id === entry.scenarioId);
  if (!scenario) {
    return [];
  }
  const node = scenario.nodes[entry.nodeId];
  if (!node || isEndNode(node)) {
    return [];
  }
  if (entry.choiceId === 'timeout') {
    return node.onTimeout?.set ?? [];
  }
  const choice = node.choices.find((item) => item.id === entry.choiceId);
  return choice?.set ?? [];
}

export function actionServiceSkill(
  scenarios: readonly ScenarioGraph[],
  entry: JournalEntry,
): number {
  const scenario = scenarios.find((item) => item.id === entry.scenarioId);
  if (!scenario) {
    return 0;
  }
  const node = scenario.nodes[entry.nodeId];
  if (!node || isEndNode(node) || entry.choiceId === 'timeout') {
    return 0;
  }
  const choice = node.choices.find((item) => item.id === entry.choiceId);
  return choice?.skills?.service ?? 0;
}

export function followedEnd(
  scenarios: readonly ScenarioGraph[],
  entry: JournalEntry,
): { outcome: RunOutcome; node: EndNode } | null {
  const scenario = scenarios.find((item) => item.id === entry.scenarioId);
  if (!scenario) {
    return null;
  }
  const node = scenario.nodes[entry.nodeId];
  if (!node || isEndNode(node)) {
    return null;
  }
  const nextId = nextIdOf(node, entry.choiceId);
  if (!nextId) {
    return null;
  }
  const next = scenario.nodes[nextId];
  if (!next || !isEndNode(next)) {
    return null;
  }
  return { outcome: next.end, node: next };
}

export function countIncidents(state: EngineState, scenarios: readonly ScenarioGraph[]): number {
  let count = 0;
  const last = state.journal.length - 1;
  for (let index = 0; index < state.journal.length; index += 1) {
    if (skipUnfollowed(state, scenarios, index, last)) {
      continue;
    }
    const entry = state.journal[index];
    if (!entry) {
      continue;
    }
    const hit = followedEnd(scenarios, entry);
    if (hit?.outcome === 'incident') {
      count += 1;
    }
  }
  return count;
}

export function skipUnfollowed(
  state: EngineState,
  scenarios: readonly ScenarioGraph[],
  index: number,
  last: number,
): boolean {
  if (state.outcome !== 'terminated' || index !== last) {
    return false;
  }
  return !currentIsEnd(state, scenarios);
}

export function nodeTags(node: EndNode): string[] {
  const tags: string[] = [];
  pushFlags(tags, node.flags);
  pushFlags(tags, node.set);
  if (node.complaint === true && !tags.includes('complaint')) {
    tags.push('complaint');
  }
  return tags;
}

export function copyEntry(entry: JournalEntry): JournalEntry {
  return {
    idx: entry.idx,
    gameTime: entry.gameTime,
    stage: entry.stage,
    scenarioId: entry.scenarioId,
    nodeId: entry.nodeId,
    choiceId: entry.choiceId,
    situation: entry.situation,
    action: entry.action,
    verdict: entry.verdict,
    loyaltyDelta: entry.loyaltyDelta,
    safetyDelta: entry.safetyDelta,
    reactionMs: entry.reactionMs,
    timerSec: entry.timerSec,
    consequence: entry.consequence,
    lucky: entry.lucky,
    better: entry.better,
    basis: entry.basis,
    deviation: entry.deviation,
  };
}

function nextIdOf(
  node: { choices: { id: string; next: string }[]; onTimeout?: { next: string } },
  choiceId: string,
): string | undefined {
  if (choiceId === 'timeout') {
    return node.onTimeout?.next;
  }
  return node.choices.find((item) => item.id === choiceId)?.next;
}

function currentIsEnd(state: EngineState, scenarios: readonly ScenarioGraph[]): boolean {
  const scenario = scenarios.find((item) => item.id === state.scenarioId);
  if (!scenario) {
    return false;
  }
  const node = scenario.nodes[state.nodeId];
  return node !== undefined && isEndNode(node);
}

function pushFlags(tags: string[], flags: readonly string[] | undefined): void {
  if (!flags) {
    return;
  }
  for (const flag of flags) {
    if (!tags.includes(flag)) {
      tags.push(flag);
    }
  }
}
