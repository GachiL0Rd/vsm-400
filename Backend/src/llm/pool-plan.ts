import type { LlmJobReason } from './llm.constants';
import { DEFAULT_PERSONA } from './prompt';

export function personaAt(personas: readonly string[] | undefined, index: number): string {
  if (!personas || personas.length === 0) {
    return DEFAULT_PERSONA;
  }
  const persona = personas[index % personas.length];
  return persona && persona.trim().length > 0 ? persona : DEFAULT_PERSONA;
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
