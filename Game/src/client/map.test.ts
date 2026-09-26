import { describe, expect, it } from 'vitest';
import { findRoute, isWalkable, screenToTile, TILE_SIZE, tileToScreen, zoneOf } from './map';

describe('local navigation', () => {
  it('routes through the vestibule and stays out of seats and walls', () => {
    const route = findRoute({ x: 1, y: 2 }, { x: 9, y: 3 });
    expect(route.some((tile) => zoneOf(tile) === 'vestibule')).toBe(true);
    expect(route.every(isWalkable)).toBe(true);
    expect(route.at(-1)).toEqual({ x: 9, y: 3 });
    expect(isWalkable({ x: 7, y: 1 })).toBe(false);
  });

  it('projects and picks the same tile', () => {
    for (let x = 0; x < 14; x += 1) {
      for (let y = 0; y < 6; y += 1) {
        const tile = { x, y };
        const center = tileToScreen(tile);
        expect(screenToTile(center)).toEqual(tile);
        for (const offsetX of [-0.49, 0.49]) {
          for (const offsetY of [-0.49, 0.49]) {
            expect(
              screenToTile({
                x: center.x + offsetX * TILE_SIZE,
                y: center.y + offsetY * TILE_SIZE,
              }),
            ).toEqual(tile);
          }
        }
      }
    }
  });

  it('routes around a passenger standing in the aisle', () => {
    const blocked = { x: 7, y: 2 };
    const route = findRoute({ x: 5, y: 2 }, { x: 9, y: 2 }, [blocked]);
    expect(route).not.toContainEqual(blocked);
    expect(route.some((tile) => tile.y === 3)).toBe(true);
  });
});
