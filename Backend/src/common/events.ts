import type { RunSummary } from '../engine/types';

/** Доменное событие завершения рейса. Подписчики фазы прогрессии слушают это имя. */
export const RUN_COMPLETED = 'run.completed' as const;

export type RunCompletedPayload = {
  runId: string;
  userId: string;
  sessionId: string;
  summary: RunSummary;
  suspicious: boolean;
};
