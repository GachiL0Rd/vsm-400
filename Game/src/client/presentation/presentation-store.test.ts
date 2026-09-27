import { describe, expect, it } from 'vitest';
import { type ClientCommand, GAME_PROTOCOL_VERSION, gameSnapshotSchema } from '../../common';
import { PresentationStore } from './presentation-store';

const snapshot = (revision = 1) =>
  gameSnapshotSchema.parse({
    protocolVersion: GAME_PROTOCOL_VERSION,
    type: 'snapshot',
    state: {
      attemptId: 'attempt-1',
      revision,
      timeUs: 10,
      clock: { timeScale: 1, paused: false },
      mode: { kind: 'live' },
      phase: { kind: 'pre-departure' },
      termination: null,
      activeRegionIds: ['car-1'],
      world: {
        regions: [{ id: 'car-1' }],
        cells: [{ id: 'cell-1', x: 0, y: 0, regionId: 'car-1' }],
        edges: [],
        objects: [],
      },
      entities: [
        {
          id: 'player-1',
          kind: 'player',
          appearanceId: 'conductor',
          position: { kind: 'cell', cellId: 'cell-1' },
        },
      ],
    },
  });

describe('PresentationStore', () => {
  it('replaces the public copy with a snapshot and applies a valid delta', () => {
    const sent: ClientCommand[] = [];
    const store = new PresentationStore({
      send: (command) => sent.push(command),
      nextRequestId: () => 'resync-1',
    });
    store.apply(snapshot());
    store.apply({
      protocolVersion: GAME_PROTOCOL_VERSION,
      type: 'delta',
      attemptId: 'attempt-1',
      baseRevision: 1,
      revision: 2,
      changes: {
        timeUs: 20,
        entities: {
          removeIds: [],
          upsert: [
            {
              id: 'passenger-1',
              kind: 'passenger',
              appearanceId: 'p',
              position: { kind: 'cell', cellId: 'cell-1' },
            },
          ],
        },
      },
    });
    expect(store.snapshot.publicState?.timeUs).toBe(20);
    expect(store.snapshot.publicState?.entities.map((entity) => entity.id)).toEqual([
      'player-1',
      'passenger-1',
    ]);
    expect(sent).toEqual([]);
  });

  it('requests resync rather than repairing a delta with the wrong base revision', () => {
    const sent: ClientCommand[] = [];
    const store = new PresentationStore({
      send: (command) => sent.push(command),
      nextRequestId: () => 'resync-1',
    });
    store.apply(snapshot());
    store.apply({
      protocolVersion: GAME_PROTOCOL_VERSION,
      type: 'delta',
      attemptId: 'attempt-1',
      baseRevision: 99,
      revision: 100,
      changes: { timeUs: 20 },
    });
    expect(store.snapshot.revision).toBe(1);
    expect(sent).toEqual([
      { protocolVersion: 1, type: 'resync', requestId: 'resync-1', knownRevision: 1 },
    ]);
  });

  it('keeps an offer only for the current revision and clears it on the next revision', () => {
    const store = new PresentationStore({ send: () => undefined, nextRequestId: () => 'unused' });
    store.apply(snapshot());
    store.apply({
      protocolVersion: GAME_PROTOCOL_VERSION,
      type: 'action-offer',
      requestId: 'query-1',
      revision: 1,
      target: { kind: 'entity', entityId: 'player-1' },
      actions: [
        {
          handle: 'inspect-1',
          uiKind: 'inspect',
          label: 'Inspect',
          target: { kind: 'entity', entityId: 'player-1' },
        },
      ],
    });
    expect(store.snapshot.currentOffer?.actions[0]?.handle).toBe('inspect-1');
    store.apply({
      protocolVersion: GAME_PROTOCOL_VERSION,
      type: 'delta',
      attemptId: 'attempt-1',
      baseRevision: 1,
      revision: 2,
      changes: {},
    });
    expect(store.snapshot.currentOffer).toBeNull();
  });
});
