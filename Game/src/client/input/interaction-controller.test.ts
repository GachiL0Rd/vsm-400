import { describe, expect, it } from 'vitest';
import {
  type ClientCommand,
  GAME_PROTOCOL_VERSION,
  gameDeltaSchema,
  gameSnapshotSchema,
} from '../../common';
import { PresentationStore } from '../presentation/presentation-store';
import { InteractionController } from './interaction-controller';

describe('InteractionController', () => {
  it('sends query, invoke and move commands without changing local state', () => {
    const sent: ClientCommand[] = [];
    const store = new PresentationStore({ send: () => undefined, nextRequestId: () => 'unused' });
    store.apply(
      gameSnapshotSchema.parse({
        protocolVersion: GAME_PROTOCOL_VERSION,
        type: 'snapshot',
        state: {
          attemptId: 'a1',
          revision: 3,
          timeUs: 0,
          clock: { timeScale: 1, paused: false },
          mode: { kind: 'live' },
          phase: { kind: 'pre-departure' },
          termination: null,
          activeRegionIds: [],
          world: {
            regions: [],
            cells: [
              { id: 'c1', x: 0, y: 0, regionId: 'r1' },
              { id: 'c2', x: 1, y: 0, regionId: 'r1' },
            ],
            edges: [{ id: 'c1-c2', fromCellId: 'c1', toCellId: 'c2' }],
            objects: [],
          },
          entities: [
            {
              id: 'player',
              kind: 'player',
              appearanceId: 'conductor',
              position: { kind: 'cell', cellId: 'c1' },
            },
          ],
        },
      }),
    );
    store.apply({
      protocolVersion: GAME_PROTOCOL_VERSION,
      type: 'action-offer',
      requestId: 'q1',
      revision: 3,
      target: { kind: 'cell', cellId: 'c1' },
      actions: [
        {
          handle: 'a1',
          uiKind: 'interaction',
          label: 'Use',
          target: { kind: 'cell', cellId: 'c1' },
        },
      ],
    });
    store.setConnection('connected');
    const interactions = new InteractionController(store, (command) => sent.push(command));
    interactions.invokeAction('a1');
    interactions.queryActions({ kind: 'object', objectId: 'o1' });
    interactions.invokeAction('a1'); // old offer was invalidated by the new query
    interactions.moveTo('c2');
    expect(sent.map((command) => command.type)).toEqual([
      'invoke-action',
      'query-actions',
      'move-to',
    ]);
    expect(store.snapshot.revision).toBe(3);
  });

  it('passes structured form input through invoke-action unchanged', () => {
    const sent: ClientCommand[] = [];
    const store = new PresentationStore({ send: () => undefined, nextRequestId: () => 'unused' });
    store.apply(
      gameSnapshotSchema.parse({
        protocolVersion: GAME_PROTOCOL_VERSION,
        type: 'snapshot',
        state: {
          attemptId: 'a1',
          revision: 1,
          timeUs: 0,
          clock: { timeScale: 1, paused: false },
          mode: { kind: 'live' },
          phase: { kind: 'pre-departure' },
          termination: null,
          activeRegionIds: [],
          world: { regions: [], cells: [], edges: [], objects: [] },
          entities: [],
        },
      }),
    );
    store.apply({
      protocolVersion: GAME_PROTOCOL_VERSION,
      type: 'action-offer',
      requestId: 'q1',
      revision: 1,
      target: { kind: 'entity', entityId: 'player' },
      actions: [
        {
          handle: 'journal-form',
          uiKind: 'form',
          label: 'Edit',
          target: { kind: 'entity', entityId: 'player' },
          form: {
            kind: 'acceptance-journal',
            value: {
              communication: 'unset',
              extinguisher: 'unset',
              climate: 'unset',
              emergencyBrake: 'unset',
              sanitation: 'unset',
              note: '',
              accepted: false,
            },
          },
        },
      ],
    });
    const interactions = new InteractionController(store, (command) => sent.push(command));
    const input = {
      communication: 'ok' as const,
      extinguisher: 'ok' as const,
      climate: 'ok' as const,
      emergencyBrake: 'ok' as const,
      sanitation: 'clean' as const,
      note: '',
      accepted: true,
    };

    interactions.invokeAction('journal-form', input);

    expect(sent[0]).toMatchObject({ type: 'invoke-action', actionHandle: 'journal-form', input });
  });

  it('sends the clicked cell once and does not walk the path itself', () => {
    const sent: ClientCommand[] = [];
    const store = routeStore();
    store.setConnection('connected');
    const interactions = new InteractionController(store, (command) => sent.push(command));
    interactions.moveTo('seat');
    expect(sent).toMatchObject([{ type: 'move-to', knownRevision: 0, targetCellId: 'seat' }]);

    const first = sent[0];
    if (first?.type !== 'move-to') throw new Error('Expected movement');
    store.apply({
      protocolVersion: GAME_PROTOCOL_VERSION,
      type: 'command-result',
      requestId: first.requestId,
      status: 'accepted',
      revision: 1,
    });
    expect(sent).toHaveLength(1);
    movePlayer(store, 0, 1, {
      kind: 'moving',
      edgeId: 'desk-door',
      fromCellId: 'desk',
      toCellId: 'door',
      startedAt: 0,
      arrivesAt: 1_000_000,
      progress: 0,
    });
    movePlayer(store, 1, 2, { kind: 'cell', cellId: 'door' });
    movePlayer(store, 2, 3, { kind: 'cell', cellId: 'seat' });
    expect(sent).toHaveLength(1);
  });

  it('queues a new click until the current route leaves the player in a cell', () => {
    const sent: ClientCommand[] = [];
    const store = routeStore();
    store.setConnection('connected');
    const interactions = new InteractionController(store, (command) => sent.push(command));
    interactions.moveTo('seat');
    const first = sent[0];
    if (first?.type !== 'move-to') throw new Error('Expected movement');
    store.apply({
      protocolVersion: GAME_PROTOCOL_VERSION,
      type: 'command-result',
      requestId: first.requestId,
      status: 'accepted',
      revision: 1,
    });
    movePlayer(store, 0, 1, {
      kind: 'moving',
      edgeId: 'desk-door',
      fromCellId: 'desk',
      toCellId: 'door',
      startedAt: 0,
      arrivesAt: 1_000_000,
      progress: 0,
    });
    interactions.moveTo('entry');
    expect(sent).toHaveLength(1);
    movePlayer(store, 1, 2, { kind: 'cell', cellId: 'seat' });
    expect(sent[1]).toMatchObject({ type: 'move-to', knownRevision: 2, targetCellId: 'entry' });
  });

  it('drops a rejected move, including stale-revision, instead of retrying it', () => {
    const sent: ClientCommand[] = [];
    const store = routeStore();
    store.setConnection('connected');
    const interactions = new InteractionController(store, (command) => sent.push(command));
    interactions.moveTo('seat');
    const first = sent[0];
    if (first?.type !== 'move-to') throw new Error('Expected movement');
    store.apply({
      protocolVersion: GAME_PROTOCOL_VERSION,
      type: 'command-result',
      requestId: first.requestId,
      status: 'rejected',
      revision: 0,
      code: 'stale-revision',
      message: 'stale-revision',
    });
    movePlayer(store, 0, 1, { kind: 'cell', cellId: 'desk' });
    expect(sent).toHaveLength(1);
  });
});

function routeStore(): PresentationStore {
  const cells = ['desk', 'door', 'entry', 'seat'].map((id, x) => ({
    id,
    x,
    y: 0,
    regionId: 'r1',
  }));
  const store = new PresentationStore({ send: () => undefined, nextRequestId: () => 'unused' });
  store.apply(
    gameSnapshotSchema.parse({
      protocolVersion: GAME_PROTOCOL_VERSION,
      type: 'snapshot',
      state: {
        attemptId: 'a1',
        revision: 0,
        timeUs: 0,
        clock: { timeScale: 1, paused: false },
        mode: { kind: 'live' },
        phase: { kind: 'pre-departure' },
        termination: null,
        activeRegionIds: [],
        world: {
          regions: [],
          cells,
          edges: [
            { id: 'desk-door', fromCellId: 'desk', toCellId: 'door' },
            { id: 'door-entry', fromCellId: 'door', toCellId: 'entry' },
            { id: 'entry-seat', fromCellId: 'entry', toCellId: 'seat' },
          ],
          objects: [],
        },
        entities: [
          {
            id: 'player',
            kind: 'player',
            appearanceId: 'conductor',
            position: { kind: 'cell', cellId: 'desk' },
          },
        ],
      },
    }),
  );
  return store;
}

function movePlayer(
  store: PresentationStore,
  baseRevision: number,
  revision: number,
  position:
    | {
        kind: 'cell';
        cellId: string;
      }
    | {
        kind: 'moving';
        edgeId: string;
        fromCellId: string;
        toCellId: string;
        startedAt: number;
        arrivesAt: number;
        progress: number;
      },
): void {
  store.apply(
    gameDeltaSchema.parse({
      protocolVersion: GAME_PROTOCOL_VERSION,
      type: 'delta',
      attemptId: 'a1',
      baseRevision,
      revision,
      changes: {
        entities: {
          removeIds: [],
          upsert: [
            {
              id: 'player',
              kind: 'player',
              appearanceId: 'conductor',
              position,
            },
          ],
        },
      },
    }),
  );
}
