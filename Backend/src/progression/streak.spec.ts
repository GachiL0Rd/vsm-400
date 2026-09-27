import { describe, expect, it } from 'vitest';
import { moscowDay, nextStreak } from './streak';

describe('streak', () => {
  it('полночь Москвы режет сутки, а не UTC', () => {
    const evening = new Date('2026-09-26T20:30:00Z');
    const afterMidnight = new Date('2026-09-26T21:30:00Z');
    expect(moscowDay(new Date('2026-09-26T00:30:00Z'))).toBe(moscowDay(evening));
    expect(moscowDay(afterMidnight)).toBe(moscowDay(evening) + 1);
  });

  it('серия растёт только на следующий московский день', () => {
    const day = new Date('2026-09-26T12:00:00Z');
    const same = new Date('2026-09-26T18:00:00Z');
    const next = new Date('2026-09-26T22:00:00Z');
    const gap = new Date('2026-09-28T12:00:00Z');
    expect(nextStreak(0, null, day)).toBe(1);
    expect(nextStreak(4, day, same)).toBe(4);
    expect(nextStreak(4, day, next)).toBe(5);
    expect(nextStreak(4, day, gap)).toBe(1);
  });
});
