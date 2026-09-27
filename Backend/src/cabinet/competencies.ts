import type { Competency } from '../engine/schema';

/** Порядок осей радара кабинета. Совпадает с Frontend COMPETENCIES. */
export const COMPETENCY_IDS = [
  'safety',
  'procedure',
  'detection',
  'reaction',
  'service',
  'escalation',
] as const satisfies readonly Competency[];

export const COMPETENCY_TITLES: Record<Competency, string> = {
  safety: 'Безопасность',
  procedure: 'Процедуры',
  detection: 'Обнаружение',
  reaction: 'Реакция',
  service: 'Сервис',
  escalation: 'Эскалация',
};

/**
 * Приор EWMA, пока у сотрудника нет строки CompetencyScore.
 * Тот же 50, что WEAK_SCORE кабинета: пустая история не выглядит нулём.
 */
export const DEFAULT_COMPETENCY = 50;

export function blankScores(value = DEFAULT_COMPETENCY): Record<Competency, number> {
  return {
    safety: value,
    procedure: value,
    detection: value,
    reaction: value,
    service: value,
    escalation: value,
  };
}

export function applyScores(
  rows: readonly { competency: Competency; value: number }[],
): Record<Competency, number> {
  const scores = blankScores();
  for (const row of rows) {
    scores[row.competency] = Math.round(row.value);
  }
  return scores;
}

export function sumTrend(
  deltas: readonly Partial<Record<Competency, number>>[],
): Record<Competency, number> {
  const totals = blankScores(0);
  for (const delta of deltas) {
    for (const id of COMPETENCY_IDS) {
      const value = delta[id];
      if (typeof value === 'number' && Number.isFinite(value)) {
        totals[id] += value;
      }
    }
  }
  const rounded = blankScores(0);
  for (const id of COMPETENCY_IDS) {
    rounded[id] = Math.round(totals[id]);
  }
  return rounded;
}

export function averageScores(
  rows: readonly Record<Competency, number>[],
): Record<Competency, number> {
  if (rows.length === 0) {
    return blankScores();
  }
  const totals = blankScores(0);
  for (const row of rows) {
    for (const id of COMPETENCY_IDS) {
      totals[id] += row[id];
    }
  }
  const mean = blankScores(0);
  for (const id of COMPETENCY_IDS) {
    mean[id] = Math.round(totals[id] / rows.length);
  }
  return mean;
}

/** Стабильная сортировка: при равенстве остаётся порядок осей радара. */
export function weakestCompetencies(
  scores: Record<Competency, number>,
  count: number,
): Competency[] {
  const ordered = [...COMPETENCY_IDS];
  ordered.sort((left, right) => scores[left] - scores[right]);
  return ordered.slice(0, count);
}

export function brigadeRank(
  members: readonly { id: string; callsign: string; points: number }[],
  userId: string,
): { rank: number | null; size: number } {
  const ordered = [...members];
  ordered.sort(
    (left, right) =>
      right.points - left.points || left.callsign.localeCompare(right.callsign, 'ru'),
  );
  const index = ordered.findIndex((member) => member.id === userId);
  return { rank: index < 0 ? null : index + 1, size: ordered.length };
}
