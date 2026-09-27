import { describe, expect, it } from 'vitest';
import { parseReplayInputs } from './replay-input.ts';

describe('parseReplayInputs', () => {
  it('accepts authoritative input records in simulation-time/sequence order', () => {
    expect(
      parseReplayInputs([
        { at: 0, sequence: 0, command: { kind: 'take-journal' } },
        { at: 0, sequence: 1, command: { kind: 'return-journal' } },
        { at: 10, sequence: 2, command: { kind: 'move-to', targetCellId: 'carriage.service' } },
        { at: 20, sequence: 3, command: { kind: 'take-extinguisher' } },
      ]),
    ).toHaveLength(4);
  });

  it('rejects malformed commands and non-monotonic ordering', () => {
    expect(() =>
      parseReplayInputs([{ at: 0, sequence: 0, command: { kind: 'unknown-command' } }]),
    ).toThrow();
    expect(() =>
      parseReplayInputs([
        { at: 10, sequence: 1, command: { kind: 'take-journal' } },
        { at: 5, sequence: 2, command: { kind: 'return-journal' } },
      ]),
    ).toThrow(/strictly ordered/);
  });
});
