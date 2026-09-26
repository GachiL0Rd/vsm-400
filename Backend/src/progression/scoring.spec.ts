import { describe, expect, it } from 'vitest';
import type { JournalEntry, RunSummary } from '../engine/types';
import type { ScoringParams } from '../rules/rules.schema';
import {
  COMPETENCY_TARGET_K,
  computePoints,
  ewmaCompetency,
  NEUTRAL_COMPETENCY,
  REFERENCE_TIMER_MS,
} from './scoring';

const rules: ScoringParams = {
  difficultyMult: { 1: 1, 2: 1.5, 3: 2 },
  speedBonusMax: 30,
  timeoutPenalty: 20,
  failPoints: 10,
};

function decision(reactionMs: number | null): JournalEntry {
  return {
    idx: 0,
    gameTime: '09:00',
    stage: 'enroute',
    scenarioId: 's',
    nodeId: 'n1',
    choiceId: 'ask',
    situation: 'Ситуация',
    action: 'Действие',
    verdict: 'ok',
    loyaltyDelta: 0,
    safetyDelta: 0,
    reactionMs,
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
    competencyDelta: {},
    decisions: [],
    facts: { prevented: 0, incidents: 0, complaints: 0, interventions: 0 },
    ...partial,
  };
}

describe('computePoints', () => {
  const rows: { name: string; input: RunSummary; difficulty: 1 | 2 | 3; points: number }[] = [
    {
      name: 'провал по безопасности — фикс, шкала не считается',
      input: summary({ outcome: 'terminated', loyalty: 100, safety: 100 }),
      difficulty: 3,
      points: 10,
    },
    {
      name: 'сложность 1 без таймера',
      input: summary(),
      difficulty: 1,
      points: 70,
    },
    {
      name: 'сложность 2',
      input: summary(),
      difficulty: 2,
      points: 105,
    },
    {
      name: 'сложность 3',
      input: summary(),
      difficulty: 3,
      points: 140,
    },
    {
      name: 'два timeout без реакции',
      input: summary({ timeouts: 2 }),
      difficulty: 1,
      points: 30,
    },
    {
      name: 'мгновенное решение забирает весь бонус скорости',
      input: summary({
        loyalty: 0,
        safety: 0,
        decisions: [decision(0)],
      }),
      difficulty: 1,
      points: 30,
    },
    {
      name: 'половина ориентира 15 с — половина бонуса',
      input: summary({
        loyalty: 0,
        safety: 0,
        decisions: [decision(REFERENCE_TIMER_MS / 2)],
      }),
      difficulty: 1,
      points: 15,
    },
    {
      name: 'реакция ровно в длину таймера — бонус 0',
      input: summary({
        loyalty: 0,
        safety: 0,
        decisions: [decision(REFERENCE_TIMER_MS)],
      }),
      difficulty: 1,
      points: 0,
    },
    {
      name: 'штраф timeout не уводит очки ниже нуля',
      input: summary({ loyalty: 0, safety: 0, timeouts: 3 }),
      difficulty: 1,
      points: 0,
    },
    {
      name: 'мгновенное решение и один timeout делят долю пополам',
      input: summary({ timeouts: 1, decisions: [decision(0)] }),
      difficulty: 1,
      points: 65,
    },
    {
      name: 'дробная шкала округляется',
      input: summary({ loyalty: 81, safety: 80 }),
      difficulty: 1,
      points: 81,
    },
  ];

  it.each(rows)('$name → $points', ({ input, difficulty, points }) => {
    expect(computePoints(input, difficulty, rules)).toBe(points);
  });
});

describe('ewmaCompetency', () => {
  it('из нейтрали 50 сдвигается к clamp(50 + delta·k)', () => {
    const delta = 2;
    const target = NEUTRAL_COMPETENCY + delta * COMPETENCY_TARGET_K;
    expect(target).toBe(66);
    expect(ewmaCompetency(50, delta, 0.3)).toBeCloseTo(54.8);
  });

  it('большой положительный delta упирается в 100, отрицательный — в 0', () => {
    expect(ewmaCompetency(50, 100, 1)).toBe(100);
    expect(ewmaCompetency(50, -20, 0.3)).toBeCloseTo(35);
  });
});
