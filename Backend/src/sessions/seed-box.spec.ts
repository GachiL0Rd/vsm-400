import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptSeed, encryptSeed } from './seed-box';

const key = 'ab'.repeat(32);

describe('seed-box', () => {
  it('шифр не равен seed, расшифровка сходится', () => {
    const seed = Buffer.from('cd'.repeat(32), 'hex');
    const packed = encryptSeed(seed, key);
    expect(packed).not.toBe(seed.toString('hex'));
    expect(packed.includes(seed.toString('hex'))).toBe(false);
    const opened = decryptSeed(packed, key);
    expect(opened.equals(seed)).toBe(true);
    expect(createHash('sha256').update(opened).digest('hex')).toBe(
      createHash('sha256').update(seed).digest('hex'),
    );
  });

  it('битый тег не читается', () => {
    const packed = encryptSeed(Buffer.alloc(32, 7), key);
    const raw = Buffer.from(packed, 'base64url');
    raw[15] = raw[15] === 0 ? 1 : 0;
    expect(() => decryptSeed(raw.toString('base64url'), key)).toThrow();
  });
});
