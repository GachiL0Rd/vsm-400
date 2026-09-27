import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const SECRET_BYTES = 32;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SECRET_RE = /^[0-9a-f]{64}$/;

export type ParsedApiKey = {
  id: string;
  secret: string;
};

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** sha256 секрета. В базе лежит только хеш: сам ключ показываем один раз. */
export function hashApiSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

export function generateApiSecret(): string {
  return randomBytes(SECRET_BYTES).toString('hex');
}

export function formatApiKey(id: string, secret: string): string {
  return `vsm_${id}_${secret}`;
}

/**
 * `vsm_<uuid>_<64 hex>`. UUID без подчёркиваний, поэтому первый `_` после
 * префикса отделяет id от секрета.
 */
export function parseApiKey(header: string): ParsedApiKey | null {
  if (!header.startsWith('vsm_')) {
    return null;
  }
  const rest = header.slice(4);
  const splitAt = rest.indexOf('_');
  if (splitAt <= 0) {
    return null;
  }
  const id = rest.slice(0, splitAt).toLowerCase();
  const secret = rest.slice(splitAt + 1).toLowerCase();
  if (!UUID_RE.test(id) || !SECRET_RE.test(secret)) {
    return null;
  }
  return { id, secret };
}

/**
 * Сравниваем хеши, а не сырые секреты: длина входа у timingSafeEqual
 * всегда 32 байта, даже если секрет клиент прислал другой длины
 * (до этого шага формат уже отсечён).
 */
export function secretMatches(storedHash: string, secret: string): boolean {
  if (!SECRET_RE.test(storedHash)) {
    return false;
  }
  const actual = Buffer.from(hashApiSecret(secret), 'hex');
  const expected = Buffer.from(storedHash, 'hex');
  return timingSafeEqual(actual, expected);
}
