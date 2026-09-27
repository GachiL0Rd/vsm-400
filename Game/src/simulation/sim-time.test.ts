import { describe, expect, it } from 'vitest';
import {
  assertSimTimeUs,
  millisecondsToSimTimeUs,
  secondsToSimTimeUs,
  simTimeUsToSeconds,
} from './sim-time';

describe('canonical simulation time', () => {
  it('keeps integer microseconds and converts ordinary fractional seconds exactly', () => {
    expect(assertSimTimeUs(0)).toBe(0);
    expect(assertSimTimeUs(1_000_001)).toBe(1_000_001);
    expect(secondsToSimTimeUs(1.000001)).toBe(1_000_001);
    expect(secondsToSimTimeUs(0.1)).toBe(100_000);
    expect(millisecondsToSimTimeUs(1.001)).toBe(1_001);
    expect(simTimeUsToSeconds(1_000_001)).toBe(1.000001);
  });

  it('rejects invalid canonical timestamps', () => {
    for (const value of [-1, 0.5, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => assertSimTimeUs(value)).toThrow(RangeError);
    }
    expect(assertSimTimeUs(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('rejects inputs that cannot be represented as whole safe microseconds', () => {
    for (const value of [-1, Number.NaN, Infinity, 0.0000005, 1 / 3, 9_007_199_255]) {
      expect(() => secondsToSimTimeUs(value)).toThrow(RangeError);
    }
    expect(() => millisecondsToSimTimeUs(0.0005)).toThrow(RangeError);
    expect(() => millisecondsToSimTimeUs(Number.MAX_SAFE_INTEGER)).toThrow(RangeError);
  });
});
