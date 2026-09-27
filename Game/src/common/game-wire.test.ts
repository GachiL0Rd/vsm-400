import { describe, expect, it } from 'vitest';
import {
  actionOfferSchema,
  clientCommandSchema,
  GAME_PROTOCOL_VERSION,
  gameDeltaSchema,
  gameSnapshotSchema,
  presentationEventSchema,
} from './game-wire';

describe('common game wire schemas', () => {
  it('accepts query-actions and invoke-action envelopes', () => {
    expect(
      clientCommandSchema.parse({
        protocolVersion: GAME_PROTOCOL_VERSION,
        type: 'query-actions',
        requestId: 'query-1',
        knownRevision: 3,
        target: { kind: 'entity', entityId: 'passenger-1' },
      }),
    ).toMatchObject({ type: 'query-actions' });
    expect(
      clientCommandSchema.parse({
        protocolVersion: GAME_PROTOCOL_VERSION,
        type: 'invoke-action',
        requestId: 'invoke-1',
        knownRevision: 3,
        actionHandle: 'action/3/0',
      }),
    ).toMatchObject({ type: 'invoke-action' });
  });

  it('rejects snapshots from another protocol version', () => {
    expect(gameSnapshotSchema.safeParse({ protocolVersion: 2, type: 'snapshot' }).success).toBe(
      false,
    );
  });

  it('validates delta, action offer and presentation-event envelopes', () => {
    expect(
      gameDeltaSchema.safeParse({
        protocolVersion: GAME_PROTOCOL_VERSION,
        type: 'delta',
        attemptId: 'attempt-1',
        baseRevision: 1,
        revision: 2,
        changes: { timeUs: 100 },
      }).success,
    ).toBe(true);
    expect(
      actionOfferSchema.safeParse({
        protocolVersion: GAME_PROTOCOL_VERSION,
        type: 'action-offer',
        requestId: 'query-1',
        revision: 2,
        target: { kind: 'object', objectId: 'service-point' },
        actions: [],
      }).success,
    ).toBe(true);
    expect(
      presentationEventSchema.safeParse({
        protocolVersion: GAME_PROTOCOL_VERSION,
        type: 'presentation-event',
        attemptId: 'attempt-1',
        at: 100,
        sequence: 1,
        event: { kind: 'hint', hintId: 'hint-1', presentation: 'highlight' },
      }).success,
    ).toBe(true);
  });
});
