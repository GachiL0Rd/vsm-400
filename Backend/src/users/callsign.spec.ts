import { describe, expect, it } from 'vitest';
import { allocateCallsign, randomCallsign } from './callsign';

describe('позывной', () => {
  it('состоит из 4 символов [A-Z0-9]', () => {
    for (let index = 0; index < 20; index += 1) {
      expect(randomCallsign()).toMatch(/^[A-Z0-9]{4}$/);
    }
  });

  it('берёт следующий, если текущий занят', async () => {
    const taken = new Set(['AAAA']);
    let step = 0;
    const callsign = await allocateCallsign(
      async (candidate) => taken.has(candidate),
      () => {
        step += 1;
        return step === 1 ? 'AAAA' : 'BBBB';
      },
    );
    expect(callsign).toBe('BBBB');
  });
});
