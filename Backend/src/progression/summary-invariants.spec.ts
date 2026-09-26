import { describe, expect, it } from 'vitest';
import type { JournalEntry, RunSummary } from '../engine/types';
import { MAX_DECISIONS, summaryViolations } from './summary-invariants';

function decision(reactionMs: number | null): JournalEntry {
  return {
    idx: 0,
    gameTime: '09:00',
    stage: 'enroute',
    scenarioId: 'ride',
    nodeId: 'n1',
    choiceId: 'look',
    situation: 'Ситуация',
    action: 'Действие',
    verdict: 'ok',
    loyaltyDelta: 0,
    safetyDelta: 0,
    reactionMs,
    timerSec: 15,
    consequence: null,
    lucky: false,
    better: null,
    basis: null,
    deviation: false,
  };
}

function summary(partial: Partial<RunSummary> = {}): RunSummary {
  return {
    outcome: 'completed',
    loyalty: 80,
    safety: 60,
    politeness: 70,
    timeouts: 0,
    reactionAvgMs: 1000,
    competencyDelta: {},
    decisions: [decision(800)],
    facts: { prevented: 0, incidents: 0, complaints: 0, interventions: 0 },
    ...partial,
  };
}

describe('инварианты итога рейса', () => {
  it('принимает шкалы 0..100, реакцию ≥ 0 и исход из enum', () => {
    expect(summaryViolations(summary())).toEqual([]);
    expect(
      summaryViolations(summary({ loyalty: 0, safety: 100, decisions: [decision(null)] })),
    ).toEqual([]);
  });

  it('помечает шкалу вне диапазона, чужой исход, отрицательную реакцию и простыню ходов', () => {
    expect(summaryViolations(summary({ loyalty: 140 }))).toEqual(['loyalty']);
    expect(summaryViolations(summary({ safety: Number.NaN }))).toEqual(['safety']);
    expect(summaryViolations(summary({ politeness: -1 }))).toEqual(['politeness']);
    expect(summaryViolations(summary({ outcome: 'won' as RunSummary['outcome'] }))).toEqual([
      'outcome',
    ]);
    expect(summaryViolations(summary({ decisions: [decision(-5)] }))).toEqual(['reaction']);
    const many = Array.from({ length: MAX_DECISIONS + 1 }, () => decision(10));
    expect(summaryViolations(summary({ decisions: many }))).toEqual(['decisions']);
  });
});
