import { clampScale } from './scale';
import { isEndNode, type ScenarioGraph } from './schema';
import type { JournalEntry } from './types';

/**
 * Вежливость — шкала сессии, не штраф.
 * Вежливое/сервисное решение: не timeout, вердикт best или ok
 * и хотя бы одно из: skill service > 0, компетенция сценария service, loyaltyDelta > 0.
 * Доля при пустом журнале = loyalty/100.
 * politeness = clamp(round(0.5 * loyalty + 0.5 * 100 * politeShare)).
 */
export function politenessOf(
  loyalty: number,
  journal: readonly JournalEntry[],
  scenarios: readonly ScenarioGraph[],
): number {
  const total = journal.length;
  let polite = 0;
  for (const entry of journal) {
    if (isPolite(entry, scenarios)) {
      polite += 1;
    }
  }
  const share = total === 0 ? loyalty / 100 : polite / total;
  return clampScale(Math.round(0.5 * loyalty + 0.5 * 100 * share));
}

function isPolite(entry: JournalEntry, scenarios: readonly ScenarioGraph[]): boolean {
  if (entry.choiceId === 'timeout') {
    return false;
  }
  if (entry.verdict !== 'best' && entry.verdict !== 'ok') {
    return false;
  }
  if (serviceSkill(scenarios, entry) > 0) {
    return true;
  }
  const scenario = scenarios.find((item) => item.id === entry.scenarioId);
  if (scenario?.competencies.includes('service')) {
    return true;
  }
  return entry.loyaltyDelta > 0;
}

function serviceSkill(scenarios: readonly ScenarioGraph[], entry: JournalEntry): number {
  const scenario = scenarios.find((item) => item.id === entry.scenarioId);
  const node = scenario?.nodes[entry.nodeId];
  if (!node || isEndNode(node)) {
    return 0;
  }
  const choice = node.choices.find((item) => item.id === entry.choiceId);
  return choice?.skills?.service ?? 0;
}
