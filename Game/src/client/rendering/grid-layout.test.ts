import { describe, expect, it } from 'vitest';
import { CELL_SIZE, GridLayout, WORLD_PADDING } from './grid-layout';

describe('GridLayout', () => {
  it('uses the 64 px public-world grid and finds only cells containing the pointer', () => {
    const layout = new GridLayout();
    const cells = [
      { id: 'platform', x: -1, y: 0, regionId: 'platform' },
      { id: 'carriage', x: 0, y: 0, regionId: 'carriage' },
    ];

    expect(layout.pointFor(-1, 0)).toEqual({ x: WORLD_PADDING - CELL_SIZE, y: WORLD_PADDING });
    expect(layout.cellAt(cells, WORLD_PADDING + 1, WORLD_PADDING + 1)?.id).toBe('carriage');
    expect(layout.cellAt(cells, WORLD_PADDING - 1, WORLD_PADDING)?.id).toBe('platform');
    expect(layout.cellAt(cells, WORLD_PADDING + CELL_SIZE, WORLD_PADDING)).toBeNull();
  });
});
