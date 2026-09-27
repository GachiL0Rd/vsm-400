import type Phaser from 'phaser';
import type { PublicEntityView, PublicGameState, PublicObjectView } from '../../common';
import { VisualRegistry } from '../presentation/visual-registry';
import { CELL_SIZE, GridLayout } from './grid-layout';

/** Draws the public world projection without deciding its state or interactions. */
export class WorldRenderer {
  readonly layout = new GridLayout();

  constructor(
    private readonly graphics: Phaser.GameObjects.Graphics,
    private readonly visuals = new VisualRegistry(),
  ) {}

  render(state: PublicGameState): void {
    this.graphics.clear();
    const regions = new Map(state.world.regions.map((region) => [region.id, region]));
    const cellById = new Map(state.world.cells.map((cell) => [cell.id, cell]));

    for (const cell of state.world.cells) {
      const point = this.layout.pointFor(cell.x, cell.y);
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
    for (const object of state.world.objects) this.drawObject(object, cellById);
    for (const entity of state.entities) this.drawEntity(entity, cellById);
  }

  private drawObject(
    object: PublicObjectView,
    cellById: ReadonlyMap<string, PublicGameState['world']['cells'][number]>,
  ): void {
    const cell = cellById.get(object.cellId);
    if (cell === undefined) return;
    const point = this.layout.pointFor(cell.x, cell.y);
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

  private drawEntity(
    entity: PublicEntityView,
    cellById: ReadonlyMap<string, PublicGameState['world']['cells'][number]>,
  ): void {
    const cellId =
      entity.position.kind === 'cell'
        ? entity.position.cellId
        : entity.position.kind === 'moving'
          ? entity.position.toCellId
          : null;
    if (cellId === null) return;
    const cell = cellById.get(cellId);
    if (cell === undefined) return;
    const point = this.layout.pointFor(cell.x, cell.y);
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
}
