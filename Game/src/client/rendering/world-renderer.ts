import type Phaser from 'phaser';
import type {
  PublicEntityView,
  PublicGameState,
  PublicObjectView,
  PublicTargetRef,
  PublicWorldView,
} from '../../common';
import { VisualRegistry } from '../presentation/visual-registry';
import { actorPose } from './actor-pose';
import { conductorTextureKey, type Direction, type Step } from './character-art';
import { markerOffsetX, objectLabel } from './object-markers';
import { mapOrigin, originFromCells, TILE_SIZE, TileLayout, type WorldFrame } from './tile-layout';
import { TRAIN2_MAP_KEY, TRAIN2_TILESETS, usesTrain2Map } from './train2-map';

type Cell = PublicWorldView['cells'][number];
type MapLayer = Phaser.Tilemaps.TilemapLayer | Phaser.Tilemaps.TilemapGPULayer;

interface MarkerBox {
  readonly x: number;
  readonly y: number;
  readonly halfW: number;
  readonly halfH: number;
}

const PASSENGER_COLORS = [0x6fb4d4, 0xb894d1, 0x8dc5a3, 0xd7a39a];
const PLAYER_HIT = 28;
const PASSENGER_HIT = 14;
const CONDUCTOR_SIZE = 56;
const PASSENGER_RADIUS = 11;

const EMPTY_FRAME: WorldFrame = {
  x: 0,
  y: 0,
  width: TILE_SIZE * 16,
  height: TILE_SIZE * 16,
};

/** Draws the public world on the server grid. The train2 map is decoration under that grid. */
export class WorldRenderer {
  private layout: TileLayout | null = null;
  private cells: readonly Cell[] = [];
  private hoveredCellId: string | null = null;
  private readonly markerBoxes = new Map<string, MarkerBox>();
  private mapLayers: MapLayer[] = [];
  private mapOriginPoint: { x: number; y: number } | null = null;
  private mapFrame: WorldFrame | null = null;
  private readonly floor: Phaser.GameObjects.Graphics;
  private readonly overlay: Phaser.GameObjects.Graphics;
  private readonly objects: Phaser.GameObjects.Graphics;
  private readonly actors: Phaser.GameObjects.Graphics;
  private readonly heldItems: Phaser.GameObjects.Graphics;
  private readonly objectLabels: Phaser.GameObjects.Text[] = [];
  private readonly passengerLabels = new Map<
    string,
    { badge: Phaser.GameObjects.Text; name: Phaser.GameObjects.Text }
  >();
  private conductor: Phaser.GameObjects.Image | null = null;
  private previousWorld: PublicGameState['world'] | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly visuals = new VisualRegistry(),
  ) {
    this.floor = scene.add.graphics().setDepth(0);
    this.overlay = scene.add.graphics().setDepth(16);
    this.objects = scene.add.graphics().setDepth(20);
    this.actors = scene.add.graphics().setDepth(30);
    this.heldItems = scene.add.graphics().setDepth(40);
  }

  render(state: PublicGameState, visualTimeUs = state.timeUs): void {
    if (this.previousWorld !== state.world) {
      this.drawWorld(state);
      this.previousWorld = state.world;
    }
    this.drawEntities(state, visualTimeUs);
  }

  clear(): void {
    this.floor.clear();
    this.overlay.clear();
    this.objects.clear();
    this.actors.clear();
    this.heldItems.clear();
    this.conductor?.setVisible(false);
    this.destroyObjectLabels();
    this.destroyPassengerLabels();
    this.destroyMap();
    this.markerBoxes.clear();
    this.layout = null;
    this.cells = [];
    this.hoveredCellId = null;
    this.previousWorld = null;
  }

  worldFrame(): WorldFrame {
    if (this.mapFrame !== null) return this.mapFrame;
    if (this.layout === null) return EMPTY_FRAME;
    return this.layout.boundsFor(this.cells);
  }

  cellAt(state: PublicGameState, worldX: number, worldY: number): Cell | null {
    return this.layout?.cellAt(state.world.cells, worldX, worldY, state.activeRegionIds) ?? null;
  }

  setHoveredCell(cellId: string | null): void {
    if (this.hoveredCellId === cellId) return;
    this.hoveredCellId = cellId;
    this.drawHover();
  }

  targetAt(
    state: PublicGameState,
    x: number,
    y: number,
    visualTimeUs: number,
  ): PublicTargetRef | null {
    const entity = this.entityAt(state, x, y, visualTimeUs);
    if (entity !== null) return entity;
    for (const object of [...state.world.objects].reverse()) {
      const box = this.markerBoxes.get(object.id);
      if (box === undefined) continue;
      if (Math.abs(box.x - x) <= box.halfW && Math.abs(box.y - y) <= box.halfH) {
        return { kind: 'object', objectId: object.id };
      }
    }
    return null;
  }

  playerPoint(state: PublicGameState, visualTimeUs: number): { x: number; y: number } | null {
    const player = state.entities.find((entity) => entity.kind === 'player');
    if (player === undefined || this.layout === null) return null;
    const pose = actorPose(this.layout, state.world.cells, player.position, visualTimeUs);
    return pose === null ? null : { x: pose.x, y: pose.y };
  }

  private drawWorld(state: PublicGameState): void {
    this.cells = state.world.cells;
    const mapped = usesTrain2Map(state.world.regions) && this.ensureMap();
    if (!mapped) this.destroyMap();
    const origin =
      mapped && this.mapOriginPoint !== null ? this.mapOriginPoint : originFromCells(this.cells);
    this.layout = new TileLayout(origin);
    if (mapped) this.floor.clear();
    else this.drawFallbackCells();
    this.drawObjects(state.world.objects);
    this.drawHover();
  }

  private ensureMap(): boolean {
    if (this.mapLayers.length > 0) return true;
    if (!this.scene.cache.tilemap.exists(TRAIN2_MAP_KEY)) return false;
    const map = this.scene.make.tilemap({ key: TRAIN2_MAP_KEY, insertNull: true });
    const tilesets = linkedTilesets(map);
    if (tilesets.length === 0) return false;
    this.mapLayers = createVisibleLayers(map, tilesets);
    if (this.mapLayers.length === 0) return false;
    this.mapOriginPoint = mapOrigin(map.properties);
    this.mapFrame = { x: 0, y: 0, width: map.widthInPixels, height: map.heightInPixels };
    return true;
  }

  private destroyMap(): void {
    for (const layer of this.mapLayers) layer.destroy();
    this.mapLayers = [];
    this.mapOriginPoint = null;
    this.mapFrame = null;
  }

  private drawFallbackCells(): void {
    this.floor.clear();
    const layout = this.layout;
    if (layout === null) return;
    for (const cell of this.cells) {
      const center = layout.centerFor(cell);
      const left = center.x - TILE_SIZE / 2 + 1;
      const top = center.y - TILE_SIZE / 2 + 1;
      this.floor.fillStyle(0x2c424b, 0.72).fillRect(left, top, TILE_SIZE - 2, TILE_SIZE - 2);
      this.floor.lineStyle(1, 0x7f989f, 0.45).strokeRect(left, top, TILE_SIZE - 2, TILE_SIZE - 2);
    }
  }

  private drawHover(): void {
    this.overlay.clear();
    const layout = this.layout;
    if (layout === null || this.hoveredCellId === null) return;
    const cell = this.cells.find((candidate) => candidate.id === this.hoveredCellId);
    if (cell === undefined) return;
    const center = layout.centerFor(cell);
    const left = center.x - TILE_SIZE / 2 + 2;
    const top = center.y - TILE_SIZE / 2 + 2;
    const size = TILE_SIZE - 4;
    this.overlay.fillStyle(0xf3ca7d, 0.16).fillRect(left, top, size, size);
    this.overlay.lineStyle(2, 0xf3ca7d, 0.95).strokeRect(left, top, size, size);
  }

  private drawObjects(objects: readonly PublicObjectView[]): void {
    this.objects.clear();
    this.destroyObjectLabels();
    this.markerBoxes.clear();
    const layout = this.layout;
    if (layout === null) return;
    const offsets = markerOffsetX(objects);
    const cells = new Map(this.cells.map((cell) => [cell.id, cell]));
    for (const object of objects) {
      const cell = cells.get(object.cellId);
      if (cell === undefined) continue;
      const center = layout.centerFor(cell);
      this.drawObject(object, center.x + (offsets.get(object.id) ?? 0), center.y);
    }
  }

  private drawObject(object: PublicObjectView, x: number, y: number): void {
    const label = this.scene.add
      .text(x, y, objectLabel(object.kind), {
        fontFamily: 'Arial',
        fontSize: '12px',
        fontStyle: 'bold',
        color: '#102b35',
        align: 'center',
      })
      .setOrigin(0.5)
      .setDepth(21);
    const halfW = Math.max(18, label.width / 2 + 5);
    const halfH = Math.max(11, label.height / 2 + 4);
    const color = this.visuals.object(object).fillColor;
    this.objects.fillStyle(color).fillRect(x - halfW, y - halfH, halfW * 2, halfH * 2);
    this.objects.lineStyle(2, 0x15333d, 1).strokeRect(x - halfW, y - halfH, halfW * 2, halfH * 2);
    this.objectLabels.push(label);
    this.markerBoxes.set(object.id, { x, y, halfW, halfH });
  }

  private drawEntities(state: PublicGameState, visualTimeUs: number): void {
    this.actors.clear();
    this.heldItems.clear();
    this.conductor?.setVisible(false);
    const activePassengers = new Set<string>();
    let passengerIndex = 0;
    for (const entity of state.entities) {
      const pose = this.poseFor(entity, state, visualTimeUs);
      if (pose === null) continue;
      if (entity.kind === 'player') this.drawPlayer(entity, state, pose, visualTimeUs);
      else {
        passengerIndex += 1;
        activePassengers.add(entity.id);
        this.drawPassenger(entity, pose, passengerIndex);
      }
      if (entity.heldItem !== undefined) this.drawHeldItem(entity, pose);
    }
    this.dropMissingPassengers(activePassengers);
  }

  private poseFor(entity: PublicEntityView, state: PublicGameState, visualTimeUs: number) {
    if (this.layout === null) return null;
    return actorPose(this.layout, state.world.cells, entity.position, visualTimeUs);
  }

  private drawPlayer(
    entity: PublicEntityView,
    state: PublicGameState,
    pose: { x: number; y: number; alpha: number },
    visualTimeUs: number,
  ): void {
    const { direction, step } = conductorFrame(entity, state, visualTimeUs);
    const key = conductorTextureKey(direction, step);
    if (!this.scene.textures.exists(key)) {
      this.actors.fillStyle(0xf2bd67, pose.alpha).fillCircle(pose.x, pose.y, 22);
      this.actors.lineStyle(3, 0x183440, pose.alpha).strokeCircle(pose.x, pose.y, 22);
      return;
    }
    if (this.conductor === null) {
      this.conductor = this.scene.add.image(pose.x, pose.y, key).setDepth(31);
      this.conductor.setDisplaySize(CONDUCTOR_SIZE, CONDUCTOR_SIZE);
    }
    this.conductor
      .setTexture(key)
      .setPosition(pose.x, pose.y)
      .setAlpha(pose.alpha)
      .setVisible(true);
  }

  private drawPassenger(
    entity: PublicEntityView,
    pose: { x: number; y: number; alpha: number },
    index: number,
  ): void {
    const color = PASSENGER_COLORS[(index - 1) % PASSENGER_COLORS.length] ?? 0x6fb4d4;
    this.actors.fillStyle(color, pose.alpha).fillCircle(pose.x, pose.y, PASSENGER_RADIUS);
    this.actors.lineStyle(2, 0x173742, pose.alpha).strokeCircle(pose.x, pose.y, PASSENGER_RADIUS);
    const labels = this.passengerLabel(entity.id, index);
    labels.badge
      .setText(String(index))
      .setPosition(pose.x, pose.y)
      .setAlpha(pose.alpha)
      .setVisible(true);
    labels.name
      .setText(`Пассажир ${index}`)
      .setPosition(pose.x, pose.y + 18)
      .setAlpha(pose.alpha)
      .setVisible(true);
  }

  private passengerLabel(
    id: string,
    index: number,
  ): {
    badge: Phaser.GameObjects.Text;
    name: Phaser.GameObjects.Text;
  } {
    const existing = this.passengerLabels.get(id);
    if (existing !== undefined) return existing;
    const labels = {
      badge: this.scene.add
        .text(0, 0, String(index), {
          fontFamily: 'Arial',
          fontSize: '12px',
          fontStyle: 'bold',
          color: '#173742',
        })
        .setOrigin(0.5)
        .setDepth(31),
      name: this.scene.add
        .text(0, 0, '', {
          fontFamily: 'Arial',
          fontSize: '11px',
          color: '#fff4dc',
          backgroundColor: '#16313bdd',
          padding: { x: 3, y: 1 },
        })
        .setOrigin(0.5)
        .setDepth(32),
    };
    this.passengerLabels.set(id, labels);
    return labels;
  }

  private drawHeldItem(
    entity: PublicEntityView,
    pose: { x: number; y: number; alpha: number },
  ): void {
    if (entity.heldItem === undefined) return;
    const color = this.visuals.heldItem(entity.heldItem.visualId).fillColor;
    this.heldItems.fillStyle(color, pose.alpha).fillCircle(pose.x + 18, pose.y - 18, 5);
    this.heldItems.lineStyle(2, 0x183440, pose.alpha).strokeCircle(pose.x + 18, pose.y - 18, 5);
  }

  private entityAt(
    state: PublicGameState,
    x: number,
    y: number,
    visualTimeUs: number,
  ): PublicTargetRef | null {
    for (const entity of [...state.entities].reverse()) {
      const pose = this.poseFor(entity, state, visualTimeUs);
      if (pose === null || pose.alpha <= 0.05) continue;
      const radius = entity.kind === 'player' ? PLAYER_HIT : PASSENGER_HIT;
      if (Math.hypot(pose.x - x, pose.y - y) <= radius) {
        return { kind: 'entity', entityId: entity.id };
      }
    }
    return null;
  }

  private dropMissingPassengers(active: ReadonlySet<string>): void {
    for (const [id, labels] of this.passengerLabels) {
      if (active.has(id)) continue;
      labels.badge.destroy();
      labels.name.destroy();
      this.passengerLabels.delete(id);
    }
  }

  private destroyObjectLabels(): void {
    for (const label of this.objectLabels) label.destroy();
    this.objectLabels.length = 0;
  }

  private destroyPassengerLabels(): void {
    for (const labels of this.passengerLabels.values()) {
      labels.badge.destroy();
      labels.name.destroy();
    }
    this.passengerLabels.clear();
  }
}

function linkedTilesets(map: Phaser.Tilemaps.Tilemap): Phaser.Tilemaps.Tileset[] {
  const tilesets: Phaser.Tilemaps.Tileset[] = [];
  for (const entry of TRAIN2_TILESETS) {
    const tileset = map.addTilesetImage(entry.name, entry.key);
    if (tileset !== null) tilesets.push(tileset);
  }
  return tilesets;
}

function createVisibleLayers(
  map: Phaser.Tilemaps.Tilemap,
  tilesets: Phaser.Tilemaps.Tileset[],
): MapLayer[] {
  const layers: MapLayer[] = [];
  for (const layer of map.layers) {
    if (!layer.visible) continue;
    const created = map.createLayer(layer.name, tilesets, 0, 0);
    if (created === null) continue;
    created.setDepth(layers.length + 1);
    layers.push(created);
  }
  return layers;
}

function conductorFrame(
  entity: PublicEntityView,
  state: PublicGameState,
  visualTimeUs: number,
): { direction: Direction; step: Step } {
  const position = entity.position;
  if (position.kind !== 'moving') return { direction: 'front', step: 0 };
  const from = state.world.cells.find((cell) => cell.id === position.fromCellId);
  const to = state.world.cells.find((cell) => cell.id === position.toCellId);
  let direction: Direction = 'front';
  if (from !== undefined && to !== undefined) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    direction =
      Math.abs(dx) > Math.abs(dy) ? (dx >= 0 ? 'right' : 'left') : dy >= 0 ? 'front' : 'back';
  }
  const step =
    Math.floor(Math.max(0, visualTimeUs - position.startedAt) / 150_000) % 2 === 0 ? 1 : 2;
  return { direction, step };
}
