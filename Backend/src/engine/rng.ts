import { createHash, createHmac, randomBytes } from 'node:crypto';
import { EngineError } from './errors';

/**
 * Math.random не подходит: его нельзя засеять, повтор рейса не сойдётся
 * с commitment, и это не CSPRNG (V8 xorshift128+). На старте клиент видит
 * sha256(seed), сам seed вскрывается после смены.
 *
 * bcrypt — не генератор. Это KDF: соль один раз читается из CSPRNG
 * (OpenBSD bcrypt_initsalt → arc4random_buf), дальше один медленный
 * детерминированный блок. Повтор hash с той же солью не даёт новых байт.
 */

const BLOCK_PREFIX = Buffer.from('ctr');
const UINT32 = 0x1_0000_0000;

export type Rng = {
  /** [0, 1). 53 бита мантиссы из HMAC-SHA256. */
  nextFloat: () => number;
  /** Целое min..max включительно, без остатка от некратного модуля. */
  int: (min: number, max: number) => number;
  pick: <T>(items: readonly T[]) => T;
  shuffle: <T>(items: readonly T[]) => T[];
  /**
   * Независимый поток. Счётчик родителя не сдвигается, повтор той же метки
   * даёт тот же поток — метка мешается в HMAC отдельно от счётчика.
   */
  fork: (label: string) => Rng;
};

export function newSeed(): Buffer {
  return randomBytes(32);
}

export function commitOf(seed: Buffer): string {
  return createHash('sha256').update(seed).digest('hex');
}

export function createRng(seed: Buffer): Rng {
  if (!Buffer.isBuffer(seed) || seed.length !== 32) {
    throw new EngineError('RNG_SEED');
  }
  const key = Buffer.from(seed);
  let counter = 0n;

  const nextBytes = (size: number): Buffer => {
    const message = Buffer.alloc(BLOCK_PREFIX.length + 8);
    BLOCK_PREFIX.copy(message, 0);
    message.writeBigUInt64BE(counter, BLOCK_PREFIX.length);
    counter += 1n;
    const block = createHmac('sha256', key).update(message).digest();
    return Buffer.from(block.subarray(0, size));
  };

  const nextFloat = (): number => {
    const block = nextBytes(8);
    const hi = block.readUInt32BE(0) & 0x1f_ffff;
    const lo = block.readUInt32BE(4);
    return (hi * UINT32 + lo) / 2 ** 53;
  };

  // 2^32 — точная степень двойки. Хвост, который не делится на span, отбрасывается,
  // иначе остаток смещает младшие значения.
  const int = (min: number, max: number): number => {
    if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
      throw new EngineError('RNG_RANGE');
    }
    const span = max - min + 1;
    if (!Number.isSafeInteger(span) || span > UINT32) {
      throw new EngineError('RNG_RANGE');
    }
    if (span === 1) {
      return min;
    }
    const limit = UINT32 - (UINT32 % span);
    while (true) {
      const sample = nextBytes(4).readUInt32BE(0);
      if (sample < limit) {
        return min + (sample % span);
      }
    }
  };

  const pick = <T>(items: readonly T[]): T => {
    if (items.length === 0) {
      throw new EngineError('RNG_EMPTY');
    }
    const index = int(0, items.length - 1);
    const item = items[index];
    if (item === undefined) {
      throw new EngineError('RNG_EMPTY');
    }
    return item;
  };

  const shuffle = <T>(items: readonly T[]): T[] => {
    const copy = items.slice();
    for (let index = copy.length - 1; index > 0; index -= 1) {
      const swap = int(0, index);
      const current = copy[index];
      const other = copy[swap];
      if (current === undefined || other === undefined) {
        continue;
      }
      copy[index] = other;
      copy[swap] = current;
    }
    return copy;
  };

  const fork = (label: string): Rng => {
    const child = createHmac('sha256', key).update(`fork:${label}`, 'utf8').digest();
    return createRng(child);
  };

  return { nextFloat, int, pick, shuffle, fork };
}
