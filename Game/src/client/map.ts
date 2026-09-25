import type { ZoneId } from './protocol';

export interface Tile {
  x: number;
  y: number;
}
export interface ScreenPoint {
  x: number;
  y: number;
}
export const MAP_WIDTH = 14;
export const MAP_HEIGHT = 6;
export const TILE_WIDTH = 96;
export const TILE_HEIGHT = 48;
export const ORIGIN_X = 720;
export const ORIGIN_Y = 150;

const ANCHORS: Record<string, Tile> = {
  'platform-1': { x: 1, y: 2 },
  door: { x: 3, y: 2 },
  'seat-1': { x: 5, y: 1 },
  'seat-2': { x: 6, y: 4 },
  'seat-3': { x: 8, y: 1 },
  panel: { x: 9, y: 2 },
  extinguisher: { x: 12, y: 3 },
  'fire-zone': { x: 9, y: 3 },
  service: { x: 12, y: 2 },
  toilet: { x: 13, y: 2 },
};

export function tileToScreen(tile: Tile): ScreenPoint {
  return {
    x: ORIGIN_X + ((tile.x - tile.y) * TILE_WIDTH) / 2,
    y: ORIGIN_Y + ((tile.x + tile.y) * TILE_HEIGHT) / 2,
  };
}

export function screenToTile(point: ScreenPoint): Tile {
  const a = (point.x - ORIGIN_X) / (TILE_WIDTH / 2);
  const b = (point.y - ORIGIN_Y) / (TILE_HEIGHT / 2);
  return { x: Math.round((a + b) / 2), y: Math.round((b - a) / 2) };
}

export function zoneOf(tile: Tile): ZoneId {
  if (tile.x <= 2) return 'platform';
  if (tile.x === 3) return 'vestibule';
  if (tile.x <= 11) return 'cabin';
  return 'service';
}

export function isWalkable(tile: Tile): boolean {
  if (tile.x < 0 || tile.x >= MAP_WIDTH || tile.y < 0 || tile.y >= MAP_HEIGHT) return false;
  if (tile.x <= 2) return tile.y >= 1 && tile.y <= 4;
  return tile.y === 2 || tile.y === 3;
}

export function anchorFor(id: string): Tile | undefined {
  const anchor = ANCHORS[id];
  return anchor === undefined ? undefined : { ...anchor };
}

export function closestWalkable(tile: Tile): Tile | null {
  let nearest: Tile | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (let x = 0; x < MAP_WIDTH; x += 1) {
    for (let y = 0; y < MAP_HEIGHT; y += 1) {
      const candidate = { x, y };
      if (!isWalkable(candidate)) continue;
      const distance = Math.abs(x - tile.x) + Math.abs(y - tile.y);
      if (distance < nearestDistance) {
        nearest = candidate;
        nearestDistance = distance;
      }
    }
  }
  return nearest;
}

export function findRoute(from: Tile, to: Tile, blocked: readonly Tile[] = []): Tile[] {
  if (!isWalkable(from) || !isWalkable(to)) return [];
  const key = (tile: Tile): string => `${tile.x},${tile.y}`;
  const blockedKeys = new Set(blocked.map(key));
  if (blockedKeys.has(key(to)) && key(to) !== key(from)) return [];
  const queue: Tile[] = [from];
  const previous = new Map<string, Tile | null>([[key(from), null]]);
  for (let i = 0; i < queue.length; i += 1) {
    const tile = queue[i];
    if (tile === undefined) break;
    if (key(tile) === key(to)) break;
    for (const next of [
      { x: tile.x + 1, y: tile.y },
      { x: tile.x - 1, y: tile.y },
      { x: tile.x, y: tile.y + 1 },
      { x: tile.x, y: tile.y - 1 },
    ]) {
      if (!isWalkable(next) || blockedKeys.has(key(next)) || previous.has(key(next))) continue;
      previous.set(key(next), tile);
      queue.push(next);
    }
  }
  if (!previous.has(key(to))) return [];
  const route: Tile[] = [];
  let tile: Tile | null = to;
  while (tile !== null && key(tile) !== key(from)) {
    route.push(tile);
    tile = previous.get(key(tile)) ?? null;
  }
  return route.reverse();
}
