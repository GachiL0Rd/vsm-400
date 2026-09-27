import Phaser from 'phaser';
import type { InteractionController } from './input/interaction-controller';
import type { PresentationStore } from './presentation/presentation-store';
import { WorldRenderer } from './rendering/world-renderer';

export interface GameSceneDependencies {
  store: PresentationStore;
  interactions: InteractionController;
}

/** Renders only the public projection owned by the authoritative server. */
export class GameScene extends Phaser.Scene {
  private graphics!: Phaser.GameObjects.Graphics;
  private worldRenderer!: WorldRenderer;
  private readonly unsubscribe: () => void;

  constructor(private readonly dependencies: GameSceneDependencies) {
    super('GameScene');
    this.unsubscribe = dependencies.store.subscribe(() => this.redraw());
  }

  create(): void {
    this.graphics = this.add.graphics();
    this.worldRenderer = new WorldRenderer(this.graphics);
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.handlePointer(pointer.worldX, pointer.worldY);
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.unsubscribe());
    this.redraw();
  }

  private redraw(): void {
    if (!this.graphics) return;
    const state = this.dependencies.store.snapshot.publicState;
    if (state === null) {
      this.graphics.clear();
      return;
    }
    this.worldRenderer.render(state);
  }

  private handlePointer(worldX: number, worldY: number): void {
    const state = this.dependencies.store.snapshot.publicState;
    if (state === null) return;
    const cell = this.worldRenderer.layout.cellAt(state.world.cells, worldX, worldY);
    if (cell === null) return;
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
}
