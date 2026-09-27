import Phaser from 'phaser';
import type { PublicEntityView, PublicObjectView } from '../common';
import type { InteractionController } from './input/interaction-controller';
import type { PresentationStore } from './presentation/presentation-store';
import { VisualRegistry } from './presentation/visual-registry';

const CELL_SIZE = 64;
const PADDING = 32;

export interface GameSceneDependencies {
  store: PresentationStore;
  interactions: InteractionController;
}

/** Renders only the public projection owned by the authoritative server. */
export class GameScene extends Phaser.Scene {
  private graphics!: Phaser.GameObjects.Graphics;
  private readonly unsubscribe: () => void;
  private readonly visuals = new VisualRegistry();

  constructor(private readonly dependencies: GameSceneDependencies) {
    super('GameScene');
    this.unsubscribe = dependencies.store.subscribe(() => this.redraw());
  }

  create(): void {
    this.graphics = this.add.graphics();
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.handlePointer(pointer.worldX, pointer.worldY);
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.unsubscribe());
    this.redraw();
  }

  private redraw(): void {
    if (!this.graphics) return;
    this.graphics.clear();
    const state = this.dependencies.store.snapshot.publicState;
    if (state === null) return;

    const regions = new Map(state.world.regions.map((region) => [region.id, region]));
    for (const cell of state.world.cells) {
      const point = this.cellPoint(cell.x, cell.y);
      const visual = this.visuals.region(regions.get(cell.regionId) ?? { id: cell.regionId });
      this.graphics.fillStyle(visual.fillColor, 1);
      this.graphics.fillRect(point.x, point.y, CELL_SIZE, CELL_SIZE);
      this.graphics.lineStyle(
        state.activeRegionIds.includes(cell.regionId) ? 2 : 1,
        visual.borderColor,
        0.7,
      );
      this.graphics.strokeRect(point.x, point.y, CELL_SIZE, CELL_SIZE);
    }
    for (const object of state.world.objects) this.drawObject(object);
    for (const entity of state.entities) this.drawEntity(entity);
  }

  private drawObject(object: PublicObjectView): void {
    const point = this.pointForCell(object.cellId);
    if (point === null) return;
    const visual = this.visuals.object(object);
    const centerX = point.x + CELL_SIZE / 2;
    const centerY = point.y + CELL_SIZE / 2;
    this.graphics.fillStyle(visual.fillColor, 1);
    this.graphics.lineStyle(2, visual.borderColor, 1);
    if (visual.shape === 'circle') {
      this.graphics.fillCircle(centerX, centerY, 13);
      this.graphics.strokeCircle(centerX, centerY, 13);
      return;
    }
    const width = visual.shape === 'document' ? 22 : 26;
    const height = visual.shape === 'document' ? 30 : 26;
    this.graphics.fillRect(centerX - width / 2, centerY - height / 2, width, height);
    this.graphics.strokeRect(centerX - width / 2, centerY - height / 2, width, height);
  }

  private drawEntity(entity: PublicEntityView): void {
    const cellId =
      entity.position.kind === 'cell'
        ? entity.position.cellId
        : entity.position.kind === 'moving'
          ? entity.position.toCellId
          : null;
    if (cellId === null) return;
    const point = this.pointForCell(cellId);
    if (point === null) return;
    const visual = this.visuals.entity(entity);
    this.graphics.fillStyle(visual.fillColor, 1);
    this.graphics.lineStyle(3, visual.borderColor, 1);
    this.graphics.fillCircle(point.x + CELL_SIZE / 2, point.y + CELL_SIZE / 2, 12);
    this.graphics.strokeCircle(point.x + CELL_SIZE / 2, point.y + CELL_SIZE / 2, 12);
    if (entity.heldItem) {
      this.graphics.fillStyle(this.visuals.heldItem(entity.heldItem.visualId).fillColor, 1);
      this.graphics.fillCircle(point.x + 34, point.y + 14, 4);
    }
  }

  private handlePointer(worldX: number, worldY: number): void {
    const state = this.dependencies.store.snapshot.publicState;
    if (state === null) return;
    const cell = state.world.cells.find(({ x, y }) => {
      const point = this.cellPoint(x, y);
      return (
        worldX >= point.x &&
        worldX < point.x + CELL_SIZE &&
        worldY >= point.y &&
        worldY < point.y + CELL_SIZE
      );
    });
    if (cell === undefined) return;
    const entity = state.entities.find(
      (candidate) => candidate.position.kind === 'cell' && candidate.position.cellId === cell.id,
    );
    if (entity) {
      this.dependencies.interactions.queryActions({ kind: 'entity', entityId: entity.id });
      return;
    }
    const object = state.world.objects.find((candidate) => candidate.cellId === cell.id);
    if (object) {
      this.dependencies.interactions.queryActions({ kind: 'object', objectId: object.id });
      return;
    }
    this.dependencies.interactions.moveTo(cell.id);
  }

  private pointForCell(cellId: string): Phaser.Math.Vector2 | null {
    const cell = this.dependencies.store.snapshot.publicState?.world.cells.find(
      (candidate) => candidate.id === cellId,
    );
    return cell ? this.cellPoint(cell.x, cell.y) : null;
  }

  private cellPoint(x: number, y: number): Phaser.Math.Vector2 {
    return new Phaser.Math.Vector2(PADDING + x * CELL_SIZE, PADDING + y * CELL_SIZE);
  }
}
