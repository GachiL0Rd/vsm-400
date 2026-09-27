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

  it('уровень и баллы берут одни причины: RUN, ACHIEVEMENT, CHALLENGE', () => {
    expect(lifetimeLevelPoints(rows)).toBe(2490);
    expect(activePoints(rows, now)).toBe(2150);
  });

  it('сгоревший CHALLENGE остаётся в уровне и выходит из баллов', () => {
    const burned = row({ amount: 80, reason: 'CHALLENGE', expiresAt: past, expiredAt: past });
    expect(lifetimeLevelPoints([burned])).toBe(80);
    expect(activePoints([burned], now)).toBe(0);
  });

  it('ADJUST и EXPIRE не двигают ни уровень, ни баллы', () => {
    const adjust = [
      row({ amount: 25, reason: 'ADJUST', expiresAt: later }),
      row({ amount: 10, reason: 'EXPIRE' }),
    ];
    expect(lifetimeLevelPoints(adjust)).toBe(0);
    expect(activePoints(adjust, now)).toBe(0);
    expect(nearestExpiry(adjust, now)).toBeNull();
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
