import { describe, expect, it } from 'vitest';
import { createSimulationRandom, type RandomStream } from './random';

const ROOT_SEED = 0x5eed;
const STREAM_KEY = 'npc:alpha:decision';

/**
 * pure-rand 8.4.2, derivation `xoroshiro128plus/v1`.
 * Root seed 0x5eed and key `npc:alpha:decision` derive generator seed 1564451563.
 * Draws: int[0,99], int[0,99], unit, int[-3,3], int[0,99], unit.
 */
const GOLDEN_SEQUENCE = [84, 91, 0.5969192156893964, 0, 58, 0.1756034117967764] as const;

function drawGolden(
  stream: RandomStream,
): readonly [number, number, number, number, number, number] {
  return [
    stream.nextInt(0, 99),
    stream.nextInt(0, 99),
    stream.nextUnit(),
    stream.nextInt(-3, 3),
    stream.nextInt(0, 99),
    stream.nextUnit(),
  ];
}

function drawInts(stream: RandomStream): readonly [number, number, number, number] {
  return [
    stream.nextInt(0, 99),
    stream.nextInt(0, 99),
    stream.nextInt(0, 99),
    stream.nextInt(0, 99),
  ];
}

describe('simulation random', () => {
  it('replays the golden vector for the same seed and key', () => {
    const random = createSimulationRandom(ROOT_SEED);
    const stream = random.stream(STREAM_KEY);
    expect(random.stream(STREAM_KEY)).toBe(stream);

    const first = drawGolden(stream);
    const second = drawGolden(createSimulationRandom(ROOT_SEED).stream(STREAM_KEY));

    expect(first).toEqual(GOLDEN_SEQUENCE);
    expect(second).toEqual(GOLDEN_SEQUENCE);
    expect(first[2]).toBeGreaterThanOrEqual(0);
    expect(first[2]).toBeLessThan(1);
    expect(first[5]).toBeGreaterThanOrEqual(0);
    expect(first[5]).toBeLessThan(1);
  });

  it('leaves an independent stream unchanged when another consumer draws', () => {
    const baseline = drawGolden(createSimulationRandom(ROOT_SEED).stream(STREAM_KEY));
    const random = createSimulationRandom(ROOT_SEED);
    const appearance = random.stream('appearance');
    appearance.nextInt(0, 1_000);
    appearance.nextUnit();
    random.stream('passenger-generation').nextInt(0, 7);

    expect(drawGolden(random.stream(STREAM_KEY))).toEqual(baseline);
  });

  it('distinguishes a different seed from a different key', () => {
    const base = drawInts(createSimulationRandom(ROOT_SEED).stream(STREAM_KEY));
    const otherSeed = drawInts(createSimulationRandom(ROOT_SEED + 1).stream(STREAM_KEY));
    const otherKey = drawInts(createSimulationRandom(ROOT_SEED).stream('incident-generation'));

    expect(otherSeed).not.toEqual(base);
    expect(otherKey).not.toEqual(base);
    expect(otherSeed).not.toEqual(otherKey);
  });

  it('rejects invalid seeds, keys, and integer bounds', () => {
    expect(() => createSimulationRandom(Number.NaN)).toThrow(RangeError);
    expect(() => createSimulationRandom(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => createSimulationRandom(1.5)).toThrow(RangeError);
    expect(() => createSimulationRandom(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
    expect(() => createSimulationRandom(Number.MIN_SAFE_INTEGER - 1)).toThrow(RangeError);

    const random = createSimulationRandom(0);
    expect(() => random.stream('')).toThrow(RangeError);
    const stream = random.stream('scenario-generation');
    expect(() => stream.nextInt(2, 1)).toThrow(RangeError);
    expect(() => stream.nextInt(0.2, 1)).toThrow(RangeError);
    expect(() => stream.nextInt(Number.NaN, 1)).toThrow(RangeError);
    expect(() => stream.nextInt(0, Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => stream.nextInt(0, Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
  });
});
