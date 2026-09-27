import { describe, expect, it } from 'vitest';
import type { ScoringParams } from '../rules/rules.schema';
import { pointsForRun } from './run-points';

const rules: ScoringParams = {
  difficultyMult: { 1: 1, 2: 1.5, 3: 2 },
  speedBonusMax: 30,
  timeoutPenalty: 20,
  failPoints: 10,
};

describe('pointsForRun', () => {
  it('считает timeout по choiceId так же, как summary.timeouts', () => {
    const points = pointsForRun(
      {
        outcome: 'completed',
        loyalty: 80,
        safety: 60,
        decisions: [
          {
            scenarioId: 's',
            choiceId: 'ask',
            verdict: 'ok',
            reactionMs: 0,
            timerSec: 15,
          },
          {
            scenarioId: 's',
            choiceId: 'timeout',
            verdict: 'missed',
            reactionMs: 100,
            timerSec: 15,
          },
        ],
      },
      1,
      rules,
    );
    expect(points).toBe(65);
  });

  it('два timeout без живой реакции дают 30 очков на сложности 1', () => {
    const points = pointsForRun(
      {
        outcome: 'completed',
        loyalty: 80,
        safety: 60,
        decisions: [
          {
            scenarioId: 's',
            choiceId: 'timeout',
            verdict: 'missed',
            reactionMs: null,
            timerSec: 15,
          },
          {
            scenarioId: 's',
            choiceId: 'timeout',
            verdict: 'missed',
            reactionMs: null,
            timerSec: null,
          },
        ],
      },
      1,
      rules,
    );
    expect(points).toBe(30);
  });

  it('прерванный рейс — failPoints', () => {
    expect(
      pointsForRun({ outcome: 'terminated', loyalty: 100, safety: 100, decisions: [] }, 3, rules),
    ).toBe(10);
  });
});
