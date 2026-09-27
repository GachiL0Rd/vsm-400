import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mapOrigin, originFromCells, TILE_SIZE, TileLayout } from './tile-layout';
import { TRAIN2_TILESETS } from './train2-map';

describe('TileLayout', () => {
  it('places a server cell on the same Tiled tile, including a negative origin', () => {
    const layout = new TileLayout({ x: -16, y: 0 });
    const platform = { id: 'platform-origin.x-6y8', x: -6, y: 8, regionId: 'platform-origin' };
    const carriage = { id: 'carriage.x6y8', x: 6, y: 8, regionId: 'carriage-main' };

    expect(layout.centerFor(platform)).toEqual({
      x: (-6 - -16) * TILE_SIZE + TILE_SIZE / 2,
      y: 8 * TILE_SIZE + TILE_SIZE / 2,
    });
    expect(layout.centerFor(carriage)).toEqual({
      x: (6 - -16) * TILE_SIZE + TILE_SIZE / 2,
      y: 8 * TILE_SIZE + TILE_SIZE / 2,
    });

    const platformCenter = layout.centerFor(platform);
    expect(layout.cellAt([platform, carriage], platformCenter.x, platformCenter.y, [])?.id).toBe(
      platform.id,
    );
    expect(
      layout.cellAt([platform, carriage], platformCenter.x + TILE_SIZE, platformCenter.y, []),
    ).toBeNull();
    expect(layout.cellAt([platform], -1, platformCenter.y, [])).toBeNull();
  });

  it('prefers the cell whose region is active when two cells share a tile', () => {
    const layout = new TileLayout({ x: -16, y: 0 });
    const origin = { id: 'platform-origin.x-1y8', x: -1, y: 8, regionId: 'platform-origin' };
    const standard = {
      id: 'platform-standard.x-1y8',
      x: -1,
      y: 8,
      regionId: 'platform-standard',
    };
    const cells = [origin, standard];
    const center = layout.centerFor(origin);

    expect(layout.cellAt(cells, center.x, center.y, ['platform-standard'])?.id).toBe(standard.id);
    expect(layout.cellAt(cells, center.x, center.y, ['platform-origin'])?.id).toBe(origin.id);
    expect(layout.cellAt(cells, center.x, center.y, [])?.id).toBe(origin.id);
  });

  it('anchors a mapless level on the minimum cell', () => {
    const cells = [
      { id: 'platform-origin.desk', x: -2, y: 0, regionId: 'platform-origin' },
      { id: 'carriage.entry', x: 0, y: 0, regionId: 'carriage-main' },
      { id: 'carriage.seat-1', x: 1, y: 1, regionId: 'carriage-main' },
    ];
    const desk = cells[0];
    const seat = cells[2];
    if (desk === undefined || seat === undefined) throw new Error('Expected baseline cells');
    const layout = new TileLayout(originFromCells(cells));

    expect(layout.origin).toEqual({ x: -2, y: 0 });
    expect(layout.centerFor(desk)).toEqual({ x: TILE_SIZE / 2, y: TILE_SIZE / 2 });
    expect(layout.centerFor(seat)).toEqual({
      x: 3 * TILE_SIZE + TILE_SIZE / 2,
      y: TILE_SIZE + TILE_SIZE / 2,
    });
    expect(layout.boundsFor(cells)).toEqual({
      x: 0,
      y: 0,
      width: 4 * TILE_SIZE,
      height: 2 * TILE_SIZE,
    });
    expect(layout.cellAt(cells, TILE_SIZE / 2, TILE_SIZE / 2, [])?.id).toBe('platform-origin.desk');
  });

  it('reads origin and tileset names from the generated train2 map', () => {
    const map = JSON.parse(
      readFileSync(new URL('../assets/map/train2-long.map.json', import.meta.url), 'utf8'),
    ) as {
      width: number;
      height: number;
      tilewidth: number;
      properties: unknown;
      tilesets: { name: string }[];
    };

    expect(mapOrigin(map.properties)).toEqual({ x: -16, y: 0 });
    expect(map).toMatchObject({ width: 96, height: 16, tilewidth: TILE_SIZE });
    expect(map.tilesets.map((tileset) => tileset.name)).toEqual(
      TRAIN2_TILESETS.map((tileset) => tileset.name),
    );
  });

  it('reads originX and originY from Tiled properties', () => {
    expect(
      mapOrigin([
        { name: 'originX', type: 'int', value: -16 },
        { name: 'originY', type: 'int', value: 0 },
      ]),
    ).toEqual({ x: -16, y: 0 });
    expect(mapOrigin({ originX: -16, originY: 0 })).toEqual({ x: -16, y: 0 });
    expect(mapOrigin(undefined)).toBeNull();
    expect(mapOrigin([{ name: 'originX', value: -16 }])).toBeNull();
  });
});
