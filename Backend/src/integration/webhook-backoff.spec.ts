import { describe, expect, it } from 'vitest';
import { nextDeliveryState, WEBHOOK_MAX_ATTEMPTS, webhookBackoffMs } from './webhook-backoff';

describe('backoff вебхука', () => {
  it('удваивает паузу и на 8-й неудаче ставит FAILED', () => {
    expect(webhookBackoffMs(1)).toBe(30_000);
    expect(webhookBackoffMs(2)).toBe(60_000);
    expect(webhookBackoffMs(3)).toBe(120_000);
    expect(webhookBackoffMs(7)).toBe(30_000 * 64);
    expect(() => webhookBackoffMs(WEBHOOK_MAX_ATTEMPTS)).toThrow();

    const now = new Date('2026-09-26T12:00:00.000Z');
    const retry = nextDeliveryState(0, now, 'HTTP 500');
    expect(retry).toEqual({
      status: 'PENDING',
      attempts: 1,
      nextAttemptAt: new Date(now.getTime() + 30_000),
      lastError: 'HTTP 500',
    });
    const failed = nextDeliveryState(7, now, 'timeout');
    expect(failed.status).toBe('FAILED');
    expect(failed.attempts).toBe(8);
    expect(failed.nextAttemptAt).toBe(now);
  });
});
