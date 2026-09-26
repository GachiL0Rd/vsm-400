import Phaser from 'phaser';
import { screenToTile } from '../map';
import type { Selection } from '../selection';

/** Owns Phaser pointer subscriptions for the floor and selectable objects. */
export class InputManager {
  private readonly bindings = new Map<Phaser.GameObjects.GameObject, () => void>();
  private readonly onFloor = (pointer: Phaser.Input.Pointer, over: unknown[]): void => {
    if (over.length > 0 || !this.canMove()) return;
    this.moveToTile(screenToTile({ x: pointer.worldX, y: pointer.worldY }));
  };

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly canMove: () => boolean,
    private readonly moveToTile: (tile: { x: number; y: number }) => void,
    private readonly select: (selection: Selection) => void,
  ) {
    scene.input.on(Phaser.Input.Events.POINTER_UP, this.onFloor);
  }

  bindSelectable(object: Phaser.GameObjects.GameObject, selection: Selection): void {
    const handler = (): void => this.select(selection);
    object.on(Phaser.Input.Events.POINTER_UP, handler);
    this.bindings.set(object, handler);
  }

  unbind(object: Phaser.GameObjects.GameObject): void {
    const handler = this.bindings.get(object);
    if (handler !== undefined) object.off(Phaser.Input.Events.POINTER_UP, handler);
    this.bindings.delete(object);
  }

  destroy(): void {
    this.scene.input.off(Phaser.Input.Events.POINTER_UP, this.onFloor);
    for (const object of this.bindings.keys()) this.unbind(object);
  }
}
