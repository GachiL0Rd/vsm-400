import { describe, expect, it } from 'vitest';
import { activePoints, type LedgerRow, lifetimeLevelPoints, nearestExpiry } from './points';

const now = new Date('2026-09-26T12:00:00.000Z');
const soon = new Date('2026-09-28T12:00:00.000Z');
const later = new Date('2026-10-06T12:00:00.000Z');
const past = new Date('2026-09-01T12:00:00.000Z');

function row(partial: Partial<LedgerRow> & Pick<LedgerRow, 'amount' | 'reason'>): LedgerRow {
  return {
    expiresAt: null,
    expiredAt: null,
    ...partial,
  };
}

describe('баллы профиля и уровень', () => {
  const rows: LedgerRow[] = [
    row({ amount: 2000, reason: 'RUN', expiresAt: soon }),
    row({ amount: 340, reason: 'RUN', expiresAt: past, expiredAt: past }),
    row({ amount: 100, reason: 'ACHIEVEMENT', expiresAt: later }),
    row({ amount: 50, reason: 'CHALLENGE', expiresAt: later }),
    row({ amount: -340, reason: 'EXPIRE' }),
  ];

  it('уровень считает пожизненные положительные RUN и ACHIEVEMENT', () => {
    expect(lifetimeLevelPoints(rows)).toBe(2440);
  });

  it('профиль суммирует только несгоревшие гранты, включая CHALLENGE', () => {
    expect(activePoints(rows, now)).toBe(2150);
  });

  it('ближайшее сгорание — сумма одного expiresAt, поздние бакеты не мешает', () => {
    expect(nearestExpiry(rows, now)).toEqual({ points: 2000, at: soon.toISOString() });
  });

  it('два начисления в одну секунду складываются', () => {
    const same = soon;
    const bucket = [
      row({ amount: 80, reason: 'RUN', expiresAt: same }),
      row({ amount: 40, reason: 'ACHIEVEMENT', expiresAt: same }),
    ];
    expect(nearestExpiry(bucket, now)?.points).toBe(120);
  });

  it('без будущего expiresAt сгорать нечему', () => {
    expect(nearestExpiry([row({ amount: 10, reason: 'ADJUST' })], now)).toBeNull();
  });
});
