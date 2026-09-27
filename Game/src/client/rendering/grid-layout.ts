import type { PublicWorldView } from '../../common';

export const CELL_SIZE = 64;
export const WORLD_PADDING = 32;

export interface WorldPoint {
  readonly x: number;
  readonly y: number;
}

export class GridLayout {
  pointFor(x: number, y: number): WorldPoint {
    return {
      x: WORLD_PADDING + x * CELL_SIZE,
      y: WORLD_PADDING + y * CELL_SIZE,
    };
  }

  cellAt(
    cells: readonly PublicWorldView['cells'][number][],
    worldX: number,
    worldY: number,
  ): PublicWorldView['cells'][number] | null {
    return (
      cells.find((cell) => {
        const point = this.pointFor(cell.x, cell.y);
        return (
          worldX >= point.x &&
          worldX < point.x + CELL_SIZE &&
          worldY >= point.y &&
          worldY < point.y + CELL_SIZE
        );
      }) ?? null
    );
  }
}
