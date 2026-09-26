import type { Competency } from '../engine/schema';

const ORDER: readonly Competency[] = [
  'safety',
  'procedure',
  'detection',
  'reaction',
  'service',
  'escalation',
];

/** Нет строки — компетенция ещё не тренировалась, для фокуса это ноль. */
export function weakest(
  scores: readonly { competency: string; value: number }[],
  count: number,
): Competency[] {
  const value = new Map(scores.map((row) => [row.competency, row.value]));
  const ranked = ORDER.slice().sort((left, right) => {
    const delta = (value.get(left) ?? 0) - (value.get(right) ?? 0);
    if (delta !== 0) {
      return delta;
    }
    if (left < right) {
      return -1;
    }
    if (left > right) {
      return 1;
    }
    return 0;
  });
  return ranked.slice(0, count);
}
