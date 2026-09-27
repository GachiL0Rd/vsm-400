import { describe, expect, it } from 'vitest';
import { type ClientCommand, GAME_PROTOCOL_VERSION, gameSnapshotSchema } from '../../common';
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
          world: { regions: [], cells: [], edges: [], objects: [] },
          entities: [],
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
});
