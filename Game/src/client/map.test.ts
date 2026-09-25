import { describe, expect, it } from 'vitest';
import { findRoute, isWalkable, screenToTile, tileToScreen, zoneOf } from './map';

describe('local navigation', () => {
  it('routes through the vestibule and stays out of seats and walls', () => {
    const route = findRoute({ x: 1, y: 2 }, { x: 9, y: 3 });
    expect(route.some((tile) => zoneOf(tile) === 'vestibule')).toBe(true);
    expect(route.every(isWalkable)).toBe(true);
    expect(route.at(-1)).toEqual({ x: 9, y: 3 });
    expect(isWalkable({ x: 7, y: 1 })).toBe(false);
  });

  it('projects and picks the same tile', () => {
    const tile = { x: 8, y: 3 };
    expect(screenToTile(tileToScreen(tile))).toEqual(tile);
  });

  it('routes around a passenger standing in the aisle', () => {
    const blocked = { x: 7, y: 2 };
    const route = findRoute({ x: 5, y: 2 }, { x: 9, y: 2 }, [blocked]);
    expect(route).not.toContainEqual(blocked);
    expect(route.some((tile) => tile.y === 3)).toBe(true);
  });
});
