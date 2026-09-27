import type { LlmJobReason } from './llm.constants';
import { DEFAULT_PERSONA } from './prompt';

export function personaAt(personas: readonly string[] | undefined, index: number): string {
  if (!personas || personas.length === 0) {
    return DEFAULT_PERSONA;
  }
  const persona = personas[index % personas.length];
  return persona && persona.trim().length > 0 ? persona : DEFAULT_PERSONA;
}

/**
 * Примеры «не повторяй» для задачи: сначала та же персона, что у job, потом чужие.
 * Внутри группы порядок входного списка сохраняется (вызывающий даёт свежие первыми).
 */
export function avoidForJob<T extends { persona: string }>(
  rows: readonly T[],
  persona: string,
  limit = 5,
): T[] {
  const same: T[] = [];
  const other: T[] = [];
  for (const row of rows) {
    if (row.persona === persona) {
      same.push(row);
    } else {
      other.push(row);
    }
  }
  return [...same, ...other].slice(0, limit);
}

/** Сколько ещё задач поставить, чтобы APPROVED + уже стоящие в очереди добрали цель. */
export function seedDeficit(target: number, approved: number, inflight: number): number {
  return Math.max(0, target - approved - inflight);
}

/** Меньше число — раньше в BullMQ. Live обгоняет ручную догенерацию и ночной пул. */
export function priorityOf(reason: LlmJobReason): number {
  if (reason === 'live') {
    return 1;
  }
  if (reason === 'manual') {
    return 5;
  }
  return 10;
}
