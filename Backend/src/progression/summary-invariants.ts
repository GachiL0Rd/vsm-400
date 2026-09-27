import type { JournalEntry, RunSummary } from '../engine/types';

/**
 * Смена — 3–5 сценариев. 80 ходов выше живого рейса
 * и не даёт простыне решений раздуть леджер.
 */
export const MAX_DECISIONS = 80;

const OUTCOMES = new Set(['completed', 'incident', 'terminated']);

export function isRunOutcome(value: unknown): value is RunSummary['outcome'] {
  return typeof value === 'string' && OUTCOMES.has(value);
}

/** Имена шкал и полей, которые не сходятся с контрактом итога. */
export function summaryViolations(summary: RunSummary): string[] {
  const issues: string[] = [];
  if (!inScale(summary.loyalty)) {
    issues.push('loyalty');
  }
  if (!inScale(summary.safety)) {
    issues.push('safety');
  }
  if (!inScale(summary.politeness)) {
    issues.push('politeness');
  }
  if (!isRunOutcome(summary.outcome)) {
    issues.push('outcome');
  }
  if (!Array.isArray(summary.decisions)) {
    issues.push('decisions');
    return issues;
  }
  if (summary.decisions.length > MAX_DECISIONS) {
    issues.push('decisions');
  }
  for (const decision of summary.decisions) {
    if (reactionBad(decision)) {
      issues.push('reaction');
      break;
    }
  }
  return issues;
}

export function decisionList(summary: RunSummary): JournalEntry[] {
  if (!Array.isArray(summary.decisions)) {
    return [];
  }
  if (summary.decisions.length <= MAX_DECISIONS) {
    return summary.decisions;
  }
  return summary.decisions.slice(0, MAX_DECISIONS);
}

function inScale(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
}

function reactionBad(decision: JournalEntry): boolean {
  if (!decision || typeof decision !== 'object') {
    return true;
  }
  const reaction = decision.reactionMs;
  if (reaction === null) {
    return false;
  }
  return typeof reaction !== 'number' || !Number.isFinite(reaction) || reaction < 0;
}
