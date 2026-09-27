import { describe, expect, it } from 'vitest';
import { politenessOf } from './summarize';
import type { JournalEntry } from './types';

function entry(partial: Partial<JournalEntry>): JournalEntry {
  return {
    idx: 0,
    gameTime: '06:20',
    stage: 'enroute',
    scenarioId: 'ride',
    nodeId: 'ask',
    choiceId: 'do',
    situation: 'Пассажир просит воду',
    action: 'Принести воду',
    verdict: 'best',
    loyaltyDelta: 2,
    safetyDelta: 0,
    reactionMs: 1000,
    timerSec: 20,
    consequence: null,
    lucky: false,
    better: null,
    basis: null,
    deviation: false,
    ...partial,
  };
}

describe('politenessOf', () => {
  it('пустой журнал совпадает с лояльностью', () => {
    expect(politenessOf(80, [], [])).toBe(80);
    expect(politenessOf(0, [], [])).toBe(0);
  });

  it('вежливый ход поднимает долю, timeout не считается', () => {
    const polite = politenessOf(80, [entry({ verdict: 'best', loyaltyDelta: 2 })], []);
    const timeout = politenessOf(80, [entry({ choiceId: 'timeout', verdict: 'missed' })], []);
    expect(polite).toBeGreaterThan(80);
    expect(timeout).toBeLessThan(polite);
  });
});
