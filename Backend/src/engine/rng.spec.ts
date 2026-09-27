import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { EngineError } from './errors';
import { commitOf, createRng, newSeed } from './rng';

const UINT32 = 0x1_0000_0000;

function blockFloat(seed: Buffer, counter: bigint): number {
  const message = Buffer.alloc(11);
  Buffer.from('ctr').copy(message, 0);
  message.writeBigUInt64BE(counter, 3);
  const block = createHmac('sha256', seed).update(message).digest();
  const hi = block.readUInt32BE(0) & 0x1f_ffff;
  const lo = block.readUInt32BE(4);
  return (hi * UINT32 + lo) / 2 ** 53;
}

describe('rng', () => {
  it('совпадает с HMAC-SHA256 counter mode и повторяется от того же seed', () => {
    const seed = Buffer.alloc(32, 4);
    const left = createRng(seed);
    const right = createRng(Buffer.from(seed));
    expect(left.nextFloat()).toBe(blockFloat(seed, 0n));
    expect(right.nextFloat()).toBe(blockFloat(seed, 0n));
    expect(left.nextFloat()).toBe(blockFloat(seed, 1n));
    const ints = [left.int(0, 9), left.int(0, 9), left.int(0, 9)];
    const again = createRng(seed);
    again.nextFloat();
    again.nextFloat();
    expect([again.int(0, 9), again.int(0, 9), again.int(0, 9)]).toEqual(ints);
  });

  it('другой seed даёт другой первый float', () => {
    const base = Buffer.alloc(32, 4);
    const other = Buffer.from(base);
    other[31] = 5;
    expect(createRng(base).nextFloat()).not.toBe(createRng(other).nextFloat());
  });

  it('не отдаёт float вне [0, 1)', () => {
    const rng = createRng(Buffer.alloc(32, 2));
    for (let index = 0; index < 200; index += 1) {
      const value = rng.nextFloat();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('int включительный и без грубого перекоса', () => {
    const rng = createRng(Buffer.alloc(32, 1));
    expect(rng.int(4, 4)).toBe(4);
    const bins = [0, 0];
    for (let index = 0; index < 6000; index += 1) {
      const value = rng.int(0, 1);
      bins[value] += 1;
    }
    expect(bins[0]).toBeGreaterThan(2700);
    expect(bins[1]).toBeGreaterThan(2700);
    const triple = [0, 0, 0];
    for (let index = 0; index < 6000; index += 1) {
      triple[rng.int(5, 7) - 5] += 1;
    }
    for (const count of triple) {
      expect(count).toBeGreaterThan(1700);
      expect(count).toBeLessThan(2300);
    }
  });

  it('отклоняет плохой seed и перевёрнутый диапазон', () => {
    expect(() => createRng(Buffer.alloc(16))).toThrow(EngineError);
    expect(() => createRng(Buffer.alloc(16))).toThrow(
      expect.objectContaining({ code: 'RNG_SEED' }),
    );
    const bytes = new Uint8Array(32);
    expect(() => createRng(bytes as unknown as Buffer)).toThrow(EngineError);
    expect(() => createRng(Buffer.alloc(32, 1)).int(5, 3)).toThrow(EngineError);
    expect(() => createRng(Buffer.alloc(32, 1)).pick([])).toThrow(EngineError);
  });

  it('копирует seed: порча буфера вызывающего не двигает поток', () => {
    const seed = Buffer.alloc(32, 5);
    const rng = createRng(seed);
    seed[0] = 9;
    expect(rng.nextFloat()).toBe(createRng(Buffer.alloc(32, 5)).nextFloat());
  });

  it('shuffle — Fisher–Yates без мутации входа', () => {
    const seed = Buffer.alloc(32, 6);
    const items = [1, 2, 3, 4, 5];
    const rng = createRng(seed);
    const shuffled = rng.shuffle(items);
    expect(items).toEqual([1, 2, 3, 4, 5]);
    expect(shuffled.slice().sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    expect(shuffled).not.toBe(items);
    expect(createRng(seed).shuffle(items)).toEqual(shuffled);
  });

  it('pick и int на одном значении не съедают счётчик', () => {
    const seed = Buffer.alloc(32, 7);
    const rng = createRng(seed);
    expect(rng.pick(['only'])).toBe('only');
    expect(rng.int(2, 2)).toBe(2);
    expect(rng.nextFloat()).toBe(createRng(seed).nextFloat());
  });

  it('fork независим от родителя и повторяется по метке', () => {
    const seed = Buffer.alloc(32, 8);
    const parent = createRng(seed);
    const control = createRng(seed);
    const child = parent.fork('beta');
    parent.fork('other').int(1, 4);
    expect(parent.nextFloat()).toBe(control.nextFloat());
    expect(createRng(seed).fork('beta').nextFloat()).toBe(child.nextFloat());
    expect(createRng(seed).fork('a').nextFloat()).not.toBe(createRng(seed).fork('b').nextFloat());
    const left = createRng(seed).fork('вагон');
    const right = createRng(seed).fork('вагон');
    expect(left.int(0, 1000)).toBe(right.int(0, 1000));
    expect(left.shuffle(['a', 'b', 'c'])).toEqual(right.shuffle(['a', 'b', 'c']));
  });

  it('commitOf — sha256 hex, newSeed даёт 32 байта', () => {
    const seed = Buffer.alloc(32, 3);
    expect(commitOf(seed)).toBe(createHash('sha256').update(seed).digest('hex'));
    expect(commitOf(seed)).toMatch(/^[0-9a-f]{64}$/);
    const first = newSeed();
    const second = newSeed();
    expect(first).toHaveLength(32);
    expect(second).toHaveLength(32);
    expect(first.equals(second)).toBe(false);
  });
});
