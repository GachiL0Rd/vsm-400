/**
 * Три разных счёта, их нельзя склеивать:
 * - уровень — пожизненная сумма положительных начислений RUN и ACHIEVEMENT
 *   (сгоревшие тоже остаются: уровень не откатывается);
 * - баллы профиля — сумма ещё не сгоревших положительных начислений
 *   (expiredAt пуст и срок expiresAt не вышел; пустой expiresAt — бессрочное);
 * - недельный рейтинг живёт в SeasonScore и в профиль не входит.
 */
export type LedgerReason = 'RUN' | 'ACHIEVEMENT' | 'CHALLENGE' | 'EXPIRE' | 'ADJUST';

export type LedgerRow = {
  amount: number;
  reason: LedgerReason;
  expiresAt: Date | null;
  expiredAt: Date | null;
};

const LEVEL_REASONS: ReadonlySet<LedgerReason> = new Set(['RUN', 'ACHIEVEMENT']);

export function lifetimeLevelPoints(rows: readonly LedgerRow[]): number {
  let sum = 0;
  for (const row of rows) {
    if (row.amount <= 0) {
      continue;
    }
    if (!LEVEL_REASONS.has(row.reason)) {
      continue;
    }
    sum += row.amount;
  }
  return sum;
}

export function isActiveGrant(row: LedgerRow, now: Date): boolean {
  if (row.amount <= 0) {
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
