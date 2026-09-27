import { randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  formatApiKey,
  generateApiSecret,
  hashApiSecret,
  parseApiKey,
  secretMatches,
} from './api-key';

describe('ключ API', () => {
  it('собирается и разбирается как vsm_<id>_<secret>', () => {
    const id = randomUUID();
    const secret = generateApiSecret();
    const parsed = parseApiKey(formatApiKey(id, secret));
    expect(parsed).toEqual({ id, secret });
    expect(secretMatches(hashApiSecret(secret), secret)).toBe(true);
  });

  it('отличает чужой секрет и битый формат', () => {
    const id = randomUUID();
    const secret = generateApiSecret();
    const other = randomBytes(32).toString('hex');
    expect(secretMatches(hashApiSecret(secret), other)).toBe(false);
    expect(secretMatches('zz', secret)).toBe(false);
    expect(parseApiKey('')).toBeNull();
    expect(parseApiKey(`vsm_${id}`)).toBeNull();
    expect(parseApiKey(`vsm_${id}_short`)).toBeNull();
    expect(parseApiKey('bearer token')).toBeNull();
  });
});
