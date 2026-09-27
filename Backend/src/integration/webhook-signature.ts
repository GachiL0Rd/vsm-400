import { createHmac, timingSafeEqual } from 'node:crypto';

export const VSM_EVENT = 'X-VSM-Event';
export const VSM_DELIVERY = 'X-VSM-Delivery';
export const VSM_SIGNATURE = 'X-VSM-Signature';
export const VSM_TIMESTAMP = 'X-VSM-Timestamp';

export const WEBHOOK_TIMEOUT_MS = 5_000;

/** Подпись строки `timestamp + "." + сырое тело`. Секрет — UTF-8, как его показали клиенту. */
export function signWebhook(secret: string, timestamp: string, body: string): string {
  const hex = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `sha256=${hex}`;
}

export function verifyWebhook(
  secret: string,
  timestamp: string,
  body: string,
  header: string,
): boolean {
  const expected = Buffer.from(signWebhook(secret, timestamp, body));
  const given = Buffer.from(header);
  if (expected.length !== given.length) {
    return false;
  }
  return timingSafeEqual(expected, given);
}
