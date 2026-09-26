import { describe, expect, it } from 'vitest';
import {
  FLAG_AFTER_DEADLINE,
  FLAG_BEFORE_SHOW,
  FLAG_REACTION_FAST,
  isPastDeadline,
  isSuspicious,
  median,
  reactionFlag,
  SKEW_MS,
  timingFlags,
} from './anti-cheat';

describe('античит', () => {
  it('медиана быстрых ходов ставит флаг только с трёх решений', () => {
    expect(median([300, 100, 200])).toBe(200);
    expect(median([100, 200, 300, 400])).toBe(250);
    expect(reactionFlag([100, 200])).toBeNull();
    expect(reactionFlag([100, 200, 300])).toBe(FLAG_REACTION_FAST);
    expect(reactionFlag([100, 400, 500])).toBeNull();
    expect(reactionFlag([100, 200, null, 300, null])).toBe(FLAG_REACTION_FAST);
    expect(reactionFlag([100, 200, 290, 398])).toBe(FLAG_REACTION_FAST);
    expect(reactionFlag([100, 200, 300, 400])).toBeNull();
  });

  it('ранний clientTs и ход после дедлайна — разные флаги', () => {
    const shownAt = 10_000;
    const deadlineAt = 20_000;
    expect(
      timingFlags({
        clientTs: shownAt - SKEW_MS - 1,
        shownAt,
        deadlineAt,
        now: shownAt + 1000,
        choiceId: 'ask',
      }),
    ).toEqual([FLAG_BEFORE_SHOW]);
    expect(
      timingFlags({
        clientTs: shownAt - SKEW_MS,
        shownAt,
        deadlineAt,
        now: deadlineAt + SKEW_MS,
        choiceId: 'ask',
      }),
    ).toEqual([]);
    expect(
      timingFlags({
        clientTs: null,
        shownAt,
        deadlineAt,
        now: deadlineAt + SKEW_MS + 1,
        choiceId: 'ask',
      }),
    ).toEqual([FLAG_AFTER_DEADLINE]);
    expect(
      timingFlags({
        clientTs: null,
        shownAt,
        deadlineAt,
        now: deadlineAt + SKEW_MS + 1,
        choiceId: 'timeout',
      }),
    ).toEqual([]);
    expect(isPastDeadline(null, deadlineAt)).toBe(false);
    expect(isPastDeadline(deadlineAt, deadlineAt + SKEW_MS)).toBe(false);
    expect(isPastDeadline(deadlineAt, deadlineAt + SKEW_MS + 1)).toBe(true);
  });

  it('критичный флаг помечает рейс', () => {
    expect(isSuspicious([])).toBe(false);
    expect(isSuspicious(['reaction-fast'])).toBe(true);
    expect(isSuspicious(['ticket-reused'])).toBe(true);
    expect(isSuspicious(['multi-session'])).toBe(true);
  });
});
