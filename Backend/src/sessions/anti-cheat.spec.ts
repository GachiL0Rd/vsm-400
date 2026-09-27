import { describe, expect, it } from 'vitest';
import { CRITICAL_FLAGS, isSuspicious, mergeFlags } from './anti-cheat';

describe('античит', () => {
  it('подозрение только у повторного билета', () => {
    expect([...CRITICAL_FLAGS]).toEqual(['ticket-reused']);
    expect(isSuspicious([])).toBe(false);
    expect(isSuspicious(['ticket-reused'])).toBe(true);
    expect(isSuspicious(['reaction-fast'])).toBe(false);
    expect(mergeFlags(['ticket-reused'], ['ticket-reused'])).toEqual(['ticket-reused']);
    expect(mergeFlags([], ['ticket-reused'])).toEqual(['ticket-reused']);
  });
});
