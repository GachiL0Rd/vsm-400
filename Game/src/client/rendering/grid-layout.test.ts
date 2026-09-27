import { describe, expect, it } from 'vitest';
import { CELL_SIZE, GridLayout, ORIGIN_X, ORIGIN_Y } from './grid-layout';

describe('GridLayout', () => {
  it('maps the server platform and carriage cells to the reference carriage', () => {
    const layout = new GridLayout();
    const platform = { id: 'platform-origin.desk', x: -2, y: 0, regionId: 'platform-origin' };
    const carriage = { id: 'carriage.entry', x: 0, y: 0, regionId: 'carriage-main' };
    const cells = [platform, carriage];

    expect(layout.centerFor(platform)).toEqual({
      x: ORIGIN_X + 2.5 * CELL_SIZE,
      y: ORIGIN_Y + 2.5 * CELL_SIZE,
    });
    expect(layout.cellAt(cells, ORIGIN_X + 2.5 * CELL_SIZE, ORIGIN_Y + 2.5 * CELL_SIZE)?.id).toBe(
      'platform-origin.desk',
    );
    expect(layout.cellAt(cells, ORIGIN_X + 3.5 * CELL_SIZE, ORIGIN_Y + 2.5 * CELL_SIZE)?.id).toBe(
      'carriage.entry',
    );
    expect(layout.cellAt(cells.slice(1), ORIGIN_X + CELL_SIZE, ORIGIN_Y + CELL_SIZE)).toBeNull();
  });
});
