import { describe, expect, it } from 'vitest';
import {
  actionOfferSchema,
  GAME_PROTOCOL_VERSION,
  gameDeltaSchema,
  gameSnapshotSchema,
} from '../common/game-wire';
import { GameAttempt } from '../simulation/game-attempt';
import { secondsToSimTimeUs } from '../simulation/sim-time';
import { PublicGameProjection } from './public-game-session';

function createProjection(seed = 4): PublicGameProjection {
  return new PublicGameProjection({
    attemptId: 'attempt-1',
    attempt: new GameAttempt({ rootSeed: seed }),
  });
}

function moveToCell(projection: PublicGameProjection, targetCellId: string): void {
  const current = projection.snapshot().state;
  const result = projection.moveTo({
    protocolVersion: GAME_PROTOCOL_VERSION,
    type: 'move-to',
    requestId: `move-${targetCellId}`,
    knownRevision: current.revision,
    targetCellId,
  });
  if (result.result.status !== 'accepted' || result.snapshot === undefined) {
    throw new Error(`Move to ${targetCellId} was rejected`);
  }
  const player = result.snapshot.state.entities.find((entity) => entity.kind === 'player');
  if (player?.position.kind !== 'moving') throw new Error('Expected player movement');
  projection.advanceTo(player.position.arrivesAt);
}

function moveToServicePoint(projection: PublicGameProjection): void {
  for (const cellId of [
    'platform-origin.door',
    'carriage.entry',
    'carriage.cabin',
    'carriage.service',
  ]) {
    moveToCell(projection, cellId);
  }
}

describe('PublicGameProjection', () => {
  it('projects only observable state and validates the snapshot schema', () => {
    const projection = createProjection();
    const snapshot = projection.snapshot();

    expect(gameSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(snapshot.protocolVersion).toBe(GAME_PROTOCOL_VERSION);
    expect(snapshot.state.world.regions.map((region) => region.id)).toEqual([
      'carriage-main',
      'platform-origin',
    ]);
    expect(JSON.stringify(snapshot)).not.toContain('traits');
    expect(JSON.stringify(snapshot)).not.toContain('currentAction');
    expect(JSON.stringify(snapshot)).not.toContain('rootSeed');
    expect(JSON.stringify(snapshot)).not.toContain('pressureTransferWeight');
  });

  it('produces a delta when public state changes', () => {
    const projection = createProjection();
    projection.snapshot();
    const update = projection.advanceTo(secondsToSimTimeUs(5 * 60));

    expect(update.type).toBe('delta');
    if (update.type !== 'delta') throw new Error('Expected delta');
    expect(gameDeltaSchema.parse(update)).toEqual(update);
    expect(update.baseRevision).toBe(0);
    expect(update.revision).toBe(1);
    expect(update.changes.phase).toEqual({ kind: 'origin-stop' });
    expect(update.changes.entities?.upsert.map((entity) => entity.id)).toEqual([
      'passenger-1',
      'passenger-2',
      'passenger-3',
    ]);
  });

  it('offers service actions only after an explicit target query', () => {
    const projection = createProjection();
    projection.snapshot();
    moveToServicePoint(projection);

    const offer = projection.queryActions({
      protocolVersion: GAME_PROTOCOL_VERSION,
      type: 'query-actions',
      requestId: 'query-service',
      knownRevision: projection.revision,
      target: { kind: 'object', objectId: 'service-point' },
    });

    expect(actionOfferSchema.parse(offer)).toEqual(offer);
    expect(offer.actions.map((action) => action.label)).toEqual(['Взять напиток', 'Взять питание']);
    expect(offer.actions.every((action) => !action.handle.includes('drink'))).toBe(true);
  });

  it('binds action handles to the public revision and authoritative state', () => {
    const projection = createProjection();
    const attempt = projection.attempt;
    projection.snapshot();
    attempt.advanceTo(secondsToSimTimeUs(5 * 60));
    moveToServicePoint(projection);

    const offer = projection.queryActions({
      protocolVersion: GAME_PROTOCOL_VERSION,
      type: 'query-actions',
      requestId: 'query-service',
      knownRevision: projection.revision,
      target: { kind: 'object', objectId: 'service-point' },
    });
    const drink = offer.actions.find((action) => action.label === 'Взять напиток');
    expect(drink).toBeDefined();

    const offerRevision = projection.revision;
    const accepted = projection.invoke({
      protocolVersion: GAME_PROTOCOL_VERSION,
      type: 'invoke-action',
      requestId: 'take-drink',
      knownRevision: offerRevision,
      actionHandle: drink?.handle ?? 'missing',
    });
    expect(accepted.result).toMatchObject({ status: 'accepted', revision: offerRevision + 1 });
    const changedPlayer = accepted.delta?.changes.entities?.upsert.find(
      (entity) => entity.kind === 'player',
    );
    expect(changedPlayer?.heldItem?.visualId).toBe('item.drink');

    const stale = projection.invoke({
      protocolVersion: GAME_PROTOCOL_VERSION,
      type: 'invoke-action',
      requestId: 'stale',
      knownRevision: offerRevision,
      actionHandle: drink?.handle ?? 'missing',
    });
    expect(stale.result).toMatchObject({
      status: 'rejected',
      code: 'stale-revision',
      revision: offerRevision + 1,
    });
  });

  it('offers a passenger transfer without exposing waiting traits/action ids', () => {
    const projection = createProjection();
    const attempt = projection.attempt;
    projection.snapshot();
    attempt.advanceTo(secondsToSimTimeUs(5 * 60));
    moveToServicePoint(projection);
    const serviceOffer = projection.queryActions({
      protocolVersion: GAME_PROTOCOL_VERSION,
      type: 'query-actions',
      requestId: 'query-service',
      knownRevision: projection.revision,
      target: { kind: 'object', objectId: 'service-point' },
    });
    const drink = serviceOffer.actions.find((action) => action.label === 'Взять напиток');
    const take = projection.invoke({
      protocolVersion: GAME_PROTOCOL_VERSION,
      type: 'invoke-action',
      requestId: 'take-drink',
      knownRevision: projection.revision,
      actionHandle: drink?.handle ?? 'missing',
    });
    expect(take.result.status).toBe('accepted');

    const offer = projection.queryActions({
      protocolVersion: GAME_PROTOCOL_VERSION,
      type: 'query-actions',
      requestId: 'query-passenger',
      knownRevision: projection.revision,
      target: { kind: 'entity', entityId: 'passenger-3' },
    });
    expect(offer.actions.map((action) => action.label)).toEqual(['Передать напиток']);
    expect(JSON.stringify(offer)).not.toContain('waiting-drink');
    expect(JSON.stringify(offer)).not.toContain('request-drink');
  });
});
