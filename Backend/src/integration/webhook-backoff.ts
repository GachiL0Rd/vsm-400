export const WEBHOOK_MAX_ATTEMPTS = 8;

/** 30 с, затем ×2 после каждой неудачи. Восьмая неудача уже не ждёт. */
const BACKOFF_BASE_MS = 30_000;

export function webhookBackoffMs(failedAttempts: number): number {
  if (
    !Number.isInteger(failedAttempts) ||
    failedAttempts < 1 ||
    failedAttempts >= WEBHOOK_MAX_ATTEMPTS
  ) {
    throw new Error('Пауза считается для неудач 1..7');
  }
  const exponent = failedAttempts - 1;
  return BACKOFF_BASE_MS * 2 ** exponent;
}

export function nextDeliveryState(
  attempts: number,
  now: Date,
  reason: string,
): {
  status: 'PENDING' | 'FAILED';
  attempts: number;
  nextAttemptAt: Date;
  lastError: string;
} {
  const nextAttempts = attempts + 1;
  if (nextAttempts >= WEBHOOK_MAX_ATTEMPTS) {
    return {
      status: 'FAILED',
      attempts: nextAttempts,
      nextAttemptAt: now,
      lastError: reason,
    };
  }
  return {
    status: 'PENDING',
    attempts: nextAttempts,
    nextAttemptAt: new Date(now.getTime() + webhookBackoffMs(nextAttempts)),
    lastError: reason,
  };
}
