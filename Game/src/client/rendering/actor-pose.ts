import type { PublicPosition } from '../../common';
import type { TileLayout, WorldPoint } from './tile-layout';

export interface ActorPose extends WorldPoint {
  readonly alpha: number;
}

interface PoseCell {
  readonly id: string;
  readonly x: number;
  readonly y: number;
}

/** Interpolates along an edge. Door links fade across the gap instead of sliding. */
export function actorPose(
  layout: TileLayout,
  cells: readonly PoseCell[],
  position: PublicPosition,
  visualTimeUs: number,
): ActorPose | null {
  const from = cellById(cells, endpointId(position));
  if (from === undefined) return null;
  const start = layout.centerFor(from);
  if (position.kind !== 'moving') return { ...start, alpha: 1 };
  const endCell = cellById(cells, position.toCellId);
  if (endCell === undefined) return { ...start, alpha: 1 };
  const end = layout.centerFor(endCell);
  const progress = moveProgress(position.startedAt, position.arrivesAt, visualTimeUs);
  if (position.edgeId.endsWith(':door')) return doorPose(start, end, progress);
  return {
    x: start.x + (end.x - start.x) * progress,
    y: start.y + (end.y - start.y) * progress,
    alpha: 1,
  };
}

function doorPose(start: WorldPoint, end: WorldPoint, progress: number): ActorPose {
  if (progress < 0.5) return { x: start.x, y: start.y, alpha: 1 - progress * 2 };
  return { x: end.x, y: end.y, alpha: (progress - 0.5) * 2 };
}

function endpointId(position: PublicPosition): string | null {
  if (position.kind === 'moving') return position.fromCellId;
  if (position.kind === 'cell') return position.cellId;
  return null;
}

function cellById(cells: readonly PoseCell[], id: string | null): PoseCell | undefined {
  if (id === null) return undefined;
  return cells.find((cell) => cell.id === id);
}

function moveProgress(startedAt: number, arrivesAt: number, visualTimeUs: number): number {
  const duration = arrivesAt - startedAt;
  if (duration <= 0) return 1;
  return Math.min(1, Math.max(0, (visualTimeUs - startedAt) / duration));
}
