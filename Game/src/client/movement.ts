import type Phaser from 'phaser';

/** Visual interpolation only; tile routing and server validation live elsewhere. */
export function walkShape(
  body: Phaser.GameObjects.Arc,
  target: { x: number; y: number },
  distance: number,
): boolean {
  const dx = target.x - body.x;
  const dy = target.y - body.y;
  const length = Math.hypot(dx, dy);
  if (length <= distance) {
    body.setPosition(target.x, target.y);
    return true;
  }
  body.setPosition(body.x + (dx / length) * distance, body.y + (dy / length) * distance);
  return false;
}
