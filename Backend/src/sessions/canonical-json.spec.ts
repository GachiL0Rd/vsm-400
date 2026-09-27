import { describe, expect, it } from 'vitest';
import { payloadSha256 } from './canonical-json';

describe('payloadSha256', () => {
  it('не зависит от порядка ключей и зависит от порядка массива', () => {
    const left = {
      b: 1,
      a: { d: 2, c: [{ z: 1, y: 2 }] },
    };
    const right = {
      a: { c: [{ y: 2, z: 1 }], d: 2 },
      b: 1,
    };
    expect(payloadSha256(left)).toBe(payloadSha256(right));
    expect(payloadSha256([1, 2])).not.toBe(payloadSha256([2, 1]));
    expect(payloadSha256(left)).toMatch(/^[0-9a-f]{64}$/);
  });
});
