import { describe, expect, it } from 'vitest';
import type { Tile } from '../map';
import { CollisionManager } from './CollisionManager';

describe('client occupancy routing', () => {
  it('reroutes the player around an occupied aisle tile', () => {
    const npcs = new Map<string, Tile>([['a', { x: 7, y: 2 }]]);
    const collision = new CollisionManager(
      () => ({ x: 5, y: 2 }),
      () => npcs,
    );
    const plan = collision.planPlayerRoute({ x: 5, y: 2 }, { x: 9, y: 2 });
    expect(plan?.destination).toEqual({ x: 9, y: 2 });
    expect(plan?.route).not.toContainEqual({ x: 7, y: 2 });
    expect(plan?.route.some((tile) => tile.y === 3)).toBe(true);
    npcs.set('a', { x: 9, y: 2 });
    expect(collision.planPlayerRoute({ x: 5, y: 2 }, { x: 9, y: 2 })?.destination).not.toEqual({
      x: 9,
      y: 2,
    });
  });

  it('does not move an NPC through the player or another NPC', () => {
    const npcs = new Map<string, Tile>([
      ['current', { x: 9, y: 2 }],
      ['other', { x: 7, y: 2 }],
    ]);
    const collision = new CollisionManager(
      () => ({ x: 6, y: 2 }),
      () => npcs,
    );
    const route = collision.planNpcRoute({ x: 9, y: 2 }, { x: 5, y: 2 }, 'current');
    expect(route.at(-1)).toEqual({ x: 5, y: 2 });
    expect(route).not.toContainEqual({ x: 7, y: 2 });
    expect(route).not.toContainEqual({ x: 6, y: 2 });
    expect(collision.isOccupiedForNpc({ x: 7, y: 2 }, 'current')).toBe(true);
  });
});
