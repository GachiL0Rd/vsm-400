import { describe, expect, it } from 'vitest';
import {
  CRITICAL_FLAGS,
  FLAG_AFTER_DEADLINE,
  FLAG_REACTION_FAST,
  INFO_FLAGS,
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

  it('опоздание — информационный флаг, timeout и допуск 500 мс — нет', () => {
    const deadlineAt = 20_000;
    expect(
      timingFlags({
        deadlineAt,
        now: deadlineAt + SKEW_MS,
        choiceId: 'ask',
      }),
    ).toEqual([]);
    expect(
      timingFlags({
        deadlineAt,
        now: deadlineAt + SKEW_MS + 1,
        choiceId: 'ask',
      }),
    ).toEqual([FLAG_AFTER_DEADLINE]);
    expect(
      timingFlags({
        deadlineAt,
        now: deadlineAt + SKEW_MS + 1,
        choiceId: 'timeout',
      }),
    ).toEqual([]);
    expect(isPastDeadline(null, deadlineAt)).toBe(false);
    expect(isPastDeadline(deadlineAt, deadlineAt + SKEW_MS)).toBe(false);
    expect(isPastDeadline(deadlineAt, deadlineAt + SKEW_MS + 1)).toBe(true);
  });

  it('подозрение только у критических флагов', () => {
    expect([...CRITICAL_FLAGS]).toEqual(['reaction-fast', 'ticket-reused']);
    expect([...INFO_FLAGS]).toEqual(['decision-after-deadline', 'seq-jump']);
    expect(isSuspicious([])).toBe(false);
    expect(isSuspicious(['reaction-fast'])).toBe(true);
    expect(isSuspicious(['ticket-reused'])).toBe(true);
    expect(isSuspicious(['decision-after-deadline'])).toBe(false);
    expect(isSuspicious(['seq-jump'])).toBe(false);
    expect(isSuspicious(['decision-after-deadline', 'seq-jump'])).toBe(false);
    expect(isSuspicious(['seq-jump', 'ticket-reused'])).toBe(true);
  });
});
