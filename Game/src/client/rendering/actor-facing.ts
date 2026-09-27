import type { PublicPosition } from '../../common';
import type { Direction, Step } from './character-art';

const STEP_US = 150_000;

export function actorFacing(
  position: PublicPosition,
  cells: readonly { readonly id: string; readonly x: number; readonly y: number }[],
  visualTimeUs: number,
): { direction: Direction; step: Step } {
  if (position.kind !== 'moving') return { direction: 'front', step: 0 };
  const from = cells.find((cell) => cell.id === position.fromCellId);
  const to = cells.find((cell) => cell.id === position.toCellId);
  let direction: Direction = 'front';
  if (from !== undefined && to !== undefined) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    direction =
      Math.abs(dx) > Math.abs(dy) ? (dx >= 0 ? 'right' : 'left') : dy >= 0 ? 'front' : 'back';
  }
  const phase = Math.floor(Math.max(0, visualTimeUs - position.startedAt) / STEP_US);
  const step: Step = phase % 2 === 0 ? 1 : 2;
  return { direction, step };
}
