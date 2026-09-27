import { uniformInt } from 'pure-rand/distribution/uniformInt';
import { xoroshiro128plus } from 'pure-rand/generator/xoroshiro128plus';

/**
 * Named streams for one attempt.
 * Each stream is derived from `(rootSeed, stableKey)` alone, never from
 * creation order or a sequential `jump`.
 * Derivation id: `xoroshiro128plus/v1` (pure-rand 8.4.2).
 */
const DERIVATION_DOMAIN = 'vsm-400/xoroshiro128plus/v1';
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const UNIT_HI_INCLUSIVE = 0x1f_ffff;
const UNIT_LO_INCLUSIVE = 0xffff_ffff;
const UNIT_LO_SPAN = 0x1_0000_0000;
const UNIT_DENOMINATOR = 0x20_0000_0000_0000;

/** One stable named PRNG stream. Integer bounds are inclusive. */
export interface RandomStream {
  readonly key: string;
  nextInt(from: number, to: number): number;
  /** Uniform draw in `[0, 1)`, as a multiple of 2^-53. */
  nextUnit(): number;
}

/** Deterministic random context created from an attempt root seed. */
export interface SimulationRandom {
  readonly rootSeed: number;
  stream(stableKey: string): RandomStream;
}

export function createSimulationRandom(rootSeed: number): SimulationRandom {
  return new SimulationRandomContext(rootSeed);
}

class SimulationRandomContext implements SimulationRandom {
  readonly rootSeed: number;
  private readonly streams = new Map<string, RandomStream>();

  constructor(rootSeed: number) {
    this.rootSeed = assertRootSeed(rootSeed);
  }

  stream(stableKey: string): RandomStream {
    const key = assertStableKey(stableKey);
    const existing = this.streams.get(key);
    if (existing !== undefined) return existing;
    const created = new DerivedStream(this.rootSeed, key);
    this.streams.set(key, created);
    return created;
  }
}

class DerivedStream implements RandomStream {
  readonly key: string;
  private readonly rng: ReturnType<typeof xoroshiro128plus>;

  constructor(rootSeed: number, key: string) {
    this.key = key;
    this.rng = xoroshiro128plus(deriveStreamSeed(rootSeed, key));
  }

  nextInt(from: number, to: number): number {
    const lower = assertSafeInteger(from, 'Lower bound');
    const upper = assertSafeInteger(to, 'Upper bound');
    if (lower > upper) {
      throw new RangeError('Integer range must have lower bound <= upper bound');
    }
    return uniformInt(this.rng, lower, upper);
  }

  nextUnit(): number {
    const hi = uniformInt(this.rng, 0, UNIT_HI_INCLUSIVE);
    const lo = uniformInt(this.rng, 0, UNIT_LO_INCLUSIVE);
    return (hi * UNIT_LO_SPAN + lo) / UNIT_DENOMINATOR;
  }
}

function deriveStreamSeed(rootSeed: number, stableKey: string): number {
  const material = `${DERIVATION_DOMAIN}\0${rootSeed}#${stableKey.length}#${stableKey}`;
  let hash = FNV_OFFSET;
  for (let index = 0; index < material.length; index += 1) {
    const code = material.charCodeAt(index);
    hash = mixByte(hash, code >> 8);
    hash = mixByte(hash, code & 0xff);
  }
  return hash | 0;
}

function mixByte(hash: number, byte: number): number {
  return Math.imul(hash ^ byte, FNV_PRIME) >>> 0;
}

function assertRootSeed(value: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new RangeError('Root seed must be a safe integer');
  }
  return Object.is(value, -0) ? 0 : value;
}

function assertStableKey(value: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new RangeError('Stream key must be a non-empty string');
  }
  return value;
}

function assertSafeInteger(value: number, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be a safe integer`);
  }
  return value;
}
