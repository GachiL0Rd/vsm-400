import { describe, expect, it } from 'vitest';
import { actorPose } from './actor-pose';
import { TILE_SIZE, TileLayout } from './tile-layout';

const layout = new TileLayout({ x: 0, y: 0 });
const cells = [
  { id: 'platform', x: 0, y: 0 },
  { id: 'vestibule', x: 4, y: 0 },
];

describe('actorPose', () => {
  it('fades a door-link edge out at the start and in at the end', () => {
    const moving = {
      kind: 'moving' as const,
      edgeId: 'platform-origin.x-1y8->carriage.x6y8:door',
      fromCellId: 'platform',
      toCellId: 'vestibule',
      startedAt: 0,
      arrivesAt: 100,
      progress: 0,
    };

    expect(actorPose(layout, cells, moving, 0)).toEqual({
      x: TILE_SIZE / 2,
      y: TILE_SIZE / 2,
      alpha: 1,
    });
    expect(actorPose(layout, cells, moving, 25)).toEqual({
      x: TILE_SIZE / 2,
      y: TILE_SIZE / 2,
      alpha: 0.5,
    });
    expect(actorPose(layout, cells, moving, 75)).toEqual({
      x: 4 * TILE_SIZE + TILE_SIZE / 2,
      y: TILE_SIZE / 2,
      alpha: 0.5,
    });
    expect(actorPose(layout, cells, moving, 100)?.x).toBe(4 * TILE_SIZE + TILE_SIZE / 2);
  });

  it('slides a normal edge and keeps the actor opaque', () => {
    const pose = actorPose(
      layout,
      cells,
      {
        kind: 'moving',
        edgeId: 'aisle:forward',
        fromCellId: 'platform',
        toCellId: 'vestibule',
        startedAt: 0,
        arrivesAt: 100,
        progress: 0,
      },
      50,
    );

    expect(pose).toEqual({
      x: TILE_SIZE / 2 + 2 * TILE_SIZE,
      y: TILE_SIZE / 2,
      alpha: 1,
    });
  });
});
