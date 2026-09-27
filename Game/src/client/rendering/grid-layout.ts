import type { PublicWorldView } from '../../common';

export const CELL_SIZE = 76;
export const ORIGIN_X = 100;
export const ORIGIN_Y = 270;
export const MAP_WIDTH = 14;
export const MAP_HEIGHT = 6;
export const WORLD_WIDTH = ORIGIN_X * 2 + MAP_WIDTH * CELL_SIZE;
export const WORLD_HEIGHT = ORIGIN_Y * 2 + MAP_HEIGHT * CELL_SIZE;

type Cell = PublicWorldView['cells'][number];

export interface WorldPoint {
  readonly x: number;
  readonly y: number;
}

/** Places server cells on the carriage drawing without creating gameplay cells. */
export class GridLayout {
  pointFor(x: number, y: number): WorldPoint {
    return { x: ORIGIN_X + x * CELL_SIZE, y: ORIGIN_Y + y * CELL_SIZE };
  }

  centerFor(cell: Cell): WorldPoint {
    const tile = visualTile(cell);
    const point = this.pointFor(tile.x, tile.y);
    return { x: point.x + CELL_SIZE / 2, y: point.y + CELL_SIZE / 2 };
  }

  cellAt(cells: readonly Cell[], worldX: number, worldY: number): Cell | null {
    if (
      worldX < ORIGIN_X ||
      worldX >= ORIGIN_X + MAP_WIDTH * CELL_SIZE ||
      worldY < ORIGIN_Y ||
      worldY >= ORIGIN_Y + MAP_HEIGHT * CELL_SIZE
    )
      return null;
    const inPlatform = worldX < ORIGIN_X + 3 * CELL_SIZE;
    const candidates = cells.filter((cell) => cell.regionId.includes('platform') === inPlatform);
    let nearest: Cell | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const cell of candidates) {
      const point = this.centerFor(cell);
      const distance = (point.x - worldX) ** 2 + (point.y - worldY) ** 2;
      if (distance >= bestDistance) continue;
      nearest = cell;
      bestDistance = distance;
    }
    return nearest;
  }
}

function visualTile(cell: Cell): WorldPoint {
  if (cell.regionId.includes('platform')) {
    if (cell.id.endsWith('.desk')) return { x: 2, y: 2 };
    if (cell.id.endsWith('.door')) return { x: 2.5, y: 2 };
  }
  const carriageTiles: Record<string, WorldPoint> = {
    entry: { x: 3, y: 2 },
    cabin: { x: 6, y: 2 },
    'seat-1': { x: 5, y: 1 },
    'seat-2': { x: 6, y: 4 },
    'seat-3': { x: 8, y: 1 },
    service: { x: 12, y: 2 },
  };
  const suffix = cell.id.split('.').at(-1) ?? '';
  return (
    carriageTiles[suffix] ?? {
      x: Math.max(0, Math.min(13, cell.x + 3)),
      y: Math.max(0, Math.min(5, cell.y + 2)),
    }
  );
}
