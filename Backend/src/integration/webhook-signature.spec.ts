import { describe, expect, it } from 'vitest';
import { signWebhook, verifyWebhook } from './webhook-signature';

describe('подпись вебхука', () => {
  const secret = 'hook-secret';
  const timestamp = '1710000000';
  const body = '{"id":"1","event":"run.recorded"}';

  it('проверяет точное тело и время', () => {
    const header = signWebhook(secret, timestamp, body);
    expect(header.startsWith('sha256=')).toBe(true);
    expect(verifyWebhook(secret, timestamp, body, header)).toBe(true);
    expect(verifyWebhook(secret, timestamp, `${body} `, header)).toBe(false);
    expect(verifyWebhook(secret, '1710000001', body, header)).toBe(false);
    expect(verifyWebhook('other-secret', timestamp, body, header)).toBe(false);
    expect(verifyWebhook(secret, timestamp, body, header.slice(7))).toBe(false);
  });
});
