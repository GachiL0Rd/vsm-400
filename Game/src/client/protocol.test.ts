import { describe, expect, it } from 'vitest';
import { type ObservableSnapshot, PROTOCOL_VERSION, parseServerMessage } from './protocol';
import { applyServerMessage, createClientState, queueCommand } from './state';

const visible: ObservableSnapshot = {
  sessionId: 's1',
  revision: 1,
  simulationTime: 10,
  phase: 'ride',
  playerZone: 'cabin',
  message: 'Вагон тихий',
  poi: [],
  npcs: [],
  cues: [],
  tasks: [],
  dialogue: null,
  item: 'stored',
  metrics: null,
  debrief: null,
};

describe('observable client boundary', () => {
  it('discards unknown latent fields even inside nested entities', () => {
    const raw = {
      type: 'snapshot',
      protocolVersion: PROTOCOL_VERSION,
      state: {
        ...visible,
        hiddenBreach: { cell: [2, 7] },
        npcs: [
          {
            id: 'p1',
            label: 'Пассажир',
            zoneId: 'cabin',
            anchorId: 'seat-1',
            intent: { kind: 'sit', targetId: 'seat-1', sequence: 1, utility: 0.9 },
            actions: [],
            traits: { attention: 1 },
          },
        ],
      },
    };
    const parsed = parseServerMessage(JSON.stringify(raw));
    expect(parsed.type).toBe('snapshot');
    if (parsed.type !== 'snapshot') return;
    expect(JSON.stringify(parsed.state)).not.toContain('hiddenBreach');
    expect(JSON.stringify(parsed.state)).not.toContain('traits');
    expect(JSON.stringify(parsed.state)).not.toContain('utility');
  });

  it('rejects malformed observations and dialogue trees beyond two levels', () => {
    expect(() =>
      parseServerMessage(
        JSON.stringify({
          type: 'snapshot',
          protocolVersion: 1,
          state: { ...visible, npcs: false },
        }),
      ),
    ).toThrow();
    expect(() =>
      parseServerMessage(
        JSON.stringify({
          type: 'snapshot',
          protocolVersion: 1,
          state: {
            ...visible,
            dialogue: { id: 'd', npcId: 'p', title: 't', lines: [], level: 3, options: [] },
          },
        }),
      ),
    ).toThrow('depth');
  });

  it('requires ordered deltas and resynchronizes without applying a missing update', () => {
    const ready = applyServerMessage(createClientState(), {
      type: 'snapshot',
      protocolVersion: 1,
      state: visible,
    });
    const gap = applyServerMessage(ready, {
      type: 'delta',
      protocolVersion: 1,
      sessionId: 's1',
      revision: 3,
      patch: { message: 'Пожар!', cues: [{ id: 'c', kind: 'fire', text: 'Дым' }] },
    });
    expect(gap.needsResync).toBe(true);
    expect(gap.snapshot?.cues).toEqual([]);
    const recovered = applyServerMessage(gap, {
      type: 'snapshot',
      protocolVersion: 1,
      state: { ...visible, revision: 3, message: 'Синхронизировано' },
    });
    expect(recovered.needsResync).toBe(false);
    expect(recovered.snapshot?.revision).toBe(3);
    expect(recovered.snapshotSerial).toBe(2);
  });

  it('does not invent a result on ack or reject', () => {
    const ready = applyServerMessage(createClientState(), {
      type: 'snapshot',
      protocolVersion: 1,
      state: visible,
    });
    const pending = queueCommand(ready, {
      type: 'command',
      protocolVersion: 1,
      sessionId: 's1',
      requestId: 's1:1',
      baseRevision: 1,
      kind: 'inspect',
      targetId: 'panel',
      inspection: 'full',
    });
    const rejected = applyServerMessage(pending, {
      type: 'reject',
      protocolVersion: 1,
      sessionId: 's1',
      requestId: 's1:1',
      reason: 'Недоступно',
    });
    expect(rejected.pending).toEqual({});
    expect(rejected.snapshot).toEqual(visible);
    expect(rejected.notice).toContain('Недоступно');
  });
});
