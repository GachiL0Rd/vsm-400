import { TILE_SIZE } from './tile-layout';

/** 64×64 art drawn at 1.5 tiles, feet on the bottom of the cell. */
export const ACTOR_TILES = 1.5;
export const ACTOR_DISPLAY_PX = TILE_SIZE * ACTOR_TILES;
/** Opaque body is narrower than the frame, so neighbouring seats stay clickable. */
export const ACTOR_HIT_HALF_W = 26;

export function actorFeet(pose: { readonly x: number; readonly y: number }): {
  x: number;
  y: number;
} {
  return { x: pose.x, y: pose.y + TILE_SIZE / 2 };
}

/** Whole art pixels. Fractional feet shimmer once the camera zoom is an integer. */
export function actorAnchor(pose: { readonly x: number; readonly y: number }): {
  x: number;
  y: number;
} {
  const feet = actorFeet(pose);
  return { x: Math.round(feet.x), y: Math.round(feet.y) };
}

export function actorHitContains(
  worldX: number,
  worldY: number,
  feetX: number,
  feetY: number,
): boolean {
  const top = feetY - ACTOR_DISPLAY_PX;
  return (
    worldX >= feetX - ACTOR_HIT_HALF_W &&
    worldX <= feetX + ACTOR_HIT_HALF_W &&
    worldY >= top &&
    worldY <= feetY
  );
}

/** Neighbouring columns lift their name plates so the short labels do not stack. */
export function passengerLabelLift(feetX: number, linePx: number): number {
  const column = Math.floor(feetX / TILE_SIZE);
  return column % 2 === 0 ? 0 : linePx + 4;
}
