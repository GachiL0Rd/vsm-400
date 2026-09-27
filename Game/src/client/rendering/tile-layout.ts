export const TILE_SIZE = 64;

export interface TileOrigin {
  readonly x: number;
  readonly y: number;
}

export interface WorldPoint {
  readonly x: number;
  readonly y: number;
}

export interface WorldFrame {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface TileCell {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly regionId: string;
}

/** One server cell is one tile. Pixel (0, 0) is the tile at `origin`. */
export class TileLayout {
  constructor(
    readonly origin: TileOrigin,
    readonly tileSize = TILE_SIZE,
  ) {}

  centerFor(cell: { readonly x: number; readonly y: number }): WorldPoint {
    return {
      x: (cell.x - this.origin.x) * this.tileSize + this.tileSize / 2,
      y: (cell.y - this.origin.y) * this.tileSize + this.tileSize / 2,
    };
  }

  cellAt(
    cells: readonly TileCell[],
    worldX: number,
    worldY: number,
    activeRegionIds: readonly string[],
  ): TileCell | null {
    if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) return null;
    const tileX = Math.floor(worldX / this.tileSize) + this.origin.x;
    const tileY = Math.floor(worldY / this.tileSize) + this.origin.y;
    const matches = cells.filter((cell) => cell.x === tileX && cell.y === tileY);
    return preferActiveCell(matches, activeRegionIds);
  }

  boundsFor(cells: readonly { readonly x: number; readonly y: number }[]): WorldFrame {
    const first = cells[0];
    if (first === undefined) {
      return { x: 0, y: 0, width: this.tileSize, height: this.tileSize };
    }
    let minX = first.x;
    let minY = first.y;
    let maxX = first.x;
    let maxY = first.y;
    for (const cell of cells) {
      if (cell.x < minX) minX = cell.x;
      if (cell.y < minY) minY = cell.y;
      if (cell.x > maxX) maxX = cell.x;
      if (cell.y > maxY) maxY = cell.y;
    }
    return {
      x: (minX - this.origin.x) * this.tileSize,
      y: (minY - this.origin.y) * this.tileSize,
      width: (maxX - minX + 1) * this.tileSize,
      height: (maxY - minY + 1) * this.tileSize,
    };
  }
}

/** Levels without a Tiled map anchor the grid on the minimum public cell. */
export function originFromCells(
  cells: readonly { readonly x: number; readonly y: number }[],
): TileOrigin {
  const first = cells[0];
  if (first === undefined) return { x: 0, y: 0 };
  let x = first.x;
  let y = first.y;
  for (const cell of cells) {
    if (cell.x < x) x = cell.x;
    if (cell.y < y) y = cell.y;
  }
  return { x, y };
}

/** Reads Tiled map properties `originX` / `originY` (array or object form). */
export function mapOrigin(properties: unknown): TileOrigin | null {
  const x = propertyNumber(properties, 'originX');
  const y = propertyNumber(properties, 'originY');
  if (x === null || y === null) return null;
  return { x, y };
}

function preferActiveCell(
  matches: readonly TileCell[],
  activeRegionIds: readonly string[],
): TileCell | null {
  if (matches.length === 0) return null;
  const active = new Set(activeRegionIds);
  const preferred = matches.filter((cell) => active.has(cell.regionId));
  const pool = preferred.length > 0 ? preferred : matches;
  return [...pool].sort((left, right) => compareIds(left.id, right.id))[0] ?? null;
}

function propertyNumber(properties: unknown, name: string): number | null {
  if (Array.isArray(properties)) {
    for (const entry of properties) {
      const value = namedNumber(entry, name);
      if (value !== null) return value;
    }
    return null;
  }
  if (typeof properties !== 'object' || properties === null || !(name in properties)) return null;
  return finiteNumber((properties as Record<string, unknown>)[name]);
}

function namedNumber(entry: unknown, name: string): number | null {
  if (typeof entry !== 'object' || entry === null) return null;
  if (!('name' in entry) || !('value' in entry)) return null;
  if (entry.name !== name) return null;
  return finiteNumber(entry.value);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
