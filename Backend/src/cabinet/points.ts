/**
 * Три разных счёта, их нельзя склеивать:
 * - уровень — пожизненная сумма положительных RUN, ACHIEVEMENT и CHALLENGE
 *   (сгоревшие тоже остаются: уровень не откатывается);
 * - баллы профиля — те же причины, но только ещё не сгоревшие
 *   (expiredAt пуст и срок expiresAt не вышел; пустой expiresAt — бессрочное);
 * - EXPIRE и ADJUST в оба счёта не входят;
 * - недельный рейтинг живёт в SeasonScore и в профиль не входит.
 */
export type LedgerReason = 'RUN' | 'ACHIEVEMENT' | 'CHALLENGE' | 'EXPIRE' | 'ADJUST';

export type LedgerRow = {
  amount: number;
  reason: LedgerReason;
  expiresAt: Date | null;
  expiredAt: Date | null;
};

const BALANCE_REASONS: ReadonlySet<LedgerReason> = new Set(['RUN', 'ACHIEVEMENT', 'CHALLENGE']);

export function countsTowardBalance(reason: LedgerReason): boolean {
  return BALANCE_REASONS.has(reason);
}

export function lifetimeLevelPoints(rows: readonly LedgerRow[]): number {
  let sum = 0;
  for (const row of rows) {
    if (row.amount <= 0 || !countsTowardBalance(row.reason)) {
      continue;
    }
    sum += row.amount;
  }
  return sum;
}

export function isActiveGrant(row: LedgerRow, now: Date): boolean {
  if (row.amount <= 0 || !countsTowardBalance(row.reason)) {
    return false;
  }
  if (row.expiredAt) {
    return false;
  }
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) {
    return false;
  }
  return true;
}

export function activePoints(rows: readonly LedgerRow[], now: Date): number {
  let sum = 0;
  for (const row of rows) {
    if (isActiveGrant(row, now)) {
      sum += row.amount;
    }
  }
  return sum;
}

/** Ближайшее сгорание: сумма начислений с одним и тем же expiresAt. */
export function nearestExpiry(
  rows: readonly LedgerRow[],
  now: Date,
): { points: number; at: string } | null {
  let bestTime = Number.POSITIVE_INFINITY;
  let bestAt: Date | null = null;
  let points = 0;
  for (const row of rows) {
    if (!isActiveGrant(row, now) || !row.expiresAt) {
      continue;
    }
    const time = row.expiresAt.getTime();
    if (time < bestTime) {
      bestTime = time;
      bestAt = row.expiresAt;
      points = row.amount;
      continue;
    }
    if (time === bestTime) {
      points += row.amount;
    }
  }
  if (!bestAt) {
    return null;
  }
  return { points, at: bestAt.toISOString() };
}
