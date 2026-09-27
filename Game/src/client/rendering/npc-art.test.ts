import { describe, expect, it } from 'vitest';
import { actorHitContains, passengerLabelLift } from './actor-layout';
import {
  eyeSetIndex,
  isSeatCell,
  npcLayers,
  passengerBadge,
  passengerPose,
  stableModulo,
} from './npc-art';

const cells = [
  { id: 'a', x: 1, y: 8 },
  { id: 'b', x: 3, y: 8 },
  { id: 'seat', x: 4, y: 6 },
];

describe('npc layers', () => {
  it('sits on a seat cell and walks everywhere else', () => {
    expect(isSeatCell('carriage.seat.bay_02_far_L')).toBe(true);
    expect(isSeatCell('carriage.seat-1')).toBe(true);
    expect(isSeatCell('carriage.x6y8')).toBe(false);
    expect(passengerPose({ kind: 'cell', cellId: 'carriage.seat.bay_02_far_L' }, cells, 0)).toEqual(
      { kind: 'sit', direction: 'left' },
    );
    expect(
      passengerPose({ kind: 'cell', cellId: 'carriage.seat.bay_06_near_R' }, cells, 0),
    ).toEqual({ kind: 'sit', direction: 'right' });
    expect(passengerPose({ kind: 'cell', cellId: 'carriage.x6y8' }, cells, 0)).toEqual({
      kind: 'stand',
      direction: 'front',
      step: 0,
    });
  });

  it('picks a stable eye set from appearanceId and hides eyes from the back', () => {
    const left = { kind: 'sit' as const, direction: 'left' as const };
    const first = npcLayers('appearance-a', 'passenger-1', left);
    const sameAppearance = npcLayers('appearance-a', 'passenger-2', left);
    expect(first.body).toBe('npc:body:sit:left');
    expect(first.clothes).toBe('npc:clothes:sit:left');
    expect(first.eyes).toBe(sameAppearance.eyes);
    expect(eyeSetIndex('appearance-a', 'passenger-1')).toBe(eyeSetIndex('appearance-a', 'other'));
    const back = npcLayers('appearance-a', 'passenger-1', {
      kind: 'stand',
      direction: 'back',
      step: 2,
    });
    expect(back.eyes).toBeNull();
    const sets = new Set(
      ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((seed) => stableModulo(seed, 4)),
    );
    expect(sets.size).toBeGreaterThan(1);
  });

  it('uses the walk cycle while moving toward a seat', () => {
    expect(
      passengerPose(
        {
          kind: 'moving',
          edgeId: 'aisle',
          fromCellId: 'a',
          toCellId: 'b',
          startedAt: 0,
          arrivesAt: 1_000_000,
          progress: 0,
        },
        cells,
        0,
      ),
    ).toEqual({ kind: 'stand', direction: 'right', step: 1 });
    expect(
      passengerPose(
        {
          kind: 'moving',
          edgeId: 'aisle',
          fromCellId: 'a',
          toCellId: 'seat',
          startedAt: 0,
          arrivesAt: 1_000_000,
          progress: 0,
        },
        cells,
        200_000,
      ).kind,
    ).toBe('stand');
  });

  it('keeps a short badge and separates neighbouring nameplates', () => {
    expect(passengerBadge(3)).toBe('П3');
    expect(passengerLabelLift(32, 12)).toBe(0);
    expect(passengerLabelLift(96, 12)).toBe(16);
    expect(actorHitContains(100, 180, 100, 200)).toBe(true);
    expect(actorHitContains(140, 180, 100, 200)).toBe(false);
    expect(actorHitContains(100, 100, 100, 200)).toBe(false);
  });
});
