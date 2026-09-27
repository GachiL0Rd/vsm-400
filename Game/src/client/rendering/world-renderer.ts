import type Phaser from 'phaser';
import type {
  PublicEntityView,
  PublicGameState,
  PublicObjectView,
  PublicTargetRef,
  PublicWorldView,
} from '../../common';
import { VisualRegistry } from '../presentation/visual-registry';
import { actorFacing } from './actor-facing';
import {
  ACTOR_DISPLAY_PX,
  actorAnchor,
  actorHitContains,
  passengerLabelLift,
} from './actor-layout';
import { actorPose } from './actor-pose';
import { conductorTextureKey } from './character-art';
import { npcLayers, passengerBadge, passengerPose } from './npc-art';
import { markerOffsetX, objectLabel } from './object-markers';
import { mapOrigin, originFromCells, TILE_SIZE, TileLayout, type WorldFrame } from './tile-layout';
import { TRAIN2_MAP_KEY, TRAIN2_TILESETS, usesTrain2Map } from './train2-map';
import { markerFontPx } from './view-scale';

type Cell = PublicWorldView['cells'][number];
type MapLayer = Phaser.Tilemaps.TilemapLayer | Phaser.Tilemaps.TilemapGPULayer;

interface MarkerBox {
  readonly x: number;
  readonly y: number;
  readonly halfW: number;
  readonly halfH: number;
}

const PASSENGER_COLORS = [0x6fb4d4, 0xb894d1, 0x8dc5a3, 0xd7a39a];
const PASSENGER_RADIUS = 16;

interface PassengerView {
  readonly body: Phaser.GameObjects.Image;
  readonly clothes: Phaser.GameObjects.Image;
  readonly eyes: Phaser.GameObjects.Image;
  readonly label: Phaser.GameObjects.Text;
}

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
  private readonly passengers = new Map<string, PassengerView>();
  private conductor: Phaser.GameObjects.Image | null = null;
  private previousWorld: PublicGameState['world'] | null = null;
  private viewZoom = 1;
  private fontPx = 12;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly visuals = new VisualRegistry(),
  ) {
    this.floor = scene.add.graphics().setDepth(0);
    this.overlay = scene.add.graphics().setDepth(16);
    this.objects = scene.add.graphics().setDepth(20);
    this.actors = scene.add.graphics().setDepth(30);
    this.heldItems = scene.add.graphics().setDepth(5_000);
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
    this.destroyPassengers();
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

  setViewMetrics(zoom: number, dpr: number): void {
    const fontPx = markerFontPx(zoom, dpr);
    if (this.viewZoom === zoom && this.fontPx === fontPx) return;
    this.viewZoom = zoom;
    this.fontPx = fontPx;
    this.previousWorld = null;
    this.restylePassengerLabels();
  }

  refreshText(): void {
    this.previousWorld = null;
    this.restylePassengerLabels();
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
    if (mapped) {
      this.floor.clear();
      this.cropMapFrame(this.layout);
    } else this.drawFallbackCells();
    this.drawObjects(state.world.objects);
    this.drawHover();
  }

  /** The Tiled map pads the car with empty Void columns; keep the camera on playable content. */
  private cropMapFrame(layout: TileLayout): void {
    const map = this.mapFrame;
    if (map === null || this.cells.length === 0) return;
    const cells = layout.boundsFor(this.cells);
    const left = Math.max(map.x, cells.x - layout.tileSize);
    const right = Math.min(map.x + map.width, cells.x + cells.width + layout.tileSize * 2);
    this.mapFrame = { x: left, y: map.y, width: right - left, height: map.height };
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
        fontFamily: 'Monocraft, monospace',
        fontSize: `${this.fontPx}px`,
        color: '#102b35',
        align: 'center',
        resolution: Math.max(1, this.viewZoom),
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
    const queue: DrawnActor[] = [];
    let passengerIndex = 0;
    for (const entity of state.entities) {
      const pose = this.poseFor(entity, state, visualTimeUs);
      if (pose === null) continue;
      let index = 0;
      if (entity.kind !== 'player') {
        passengerIndex += 1;
        index = passengerIndex;
        activePassengers.add(entity.id);
      }
      queue.push({ entity, pose, anchor: actorAnchor(pose), index });
    }
    queue.sort(
      (left, right) =>
        left.anchor.y - right.anchor.y || left.entity.id.localeCompare(right.entity.id),
    );
    for (const actor of queue) {
      if (actor.entity.kind === 'player') this.drawPlayer(actor, state, visualTimeUs);
      else this.drawPassenger(actor, state, visualTimeUs);
      if (actor.entity.heldItem !== undefined) this.drawHeldItem(actor);
    }
    this.dropMissingPassengers(activePassengers);
  }

  private poseFor(entity: PublicEntityView, state: PublicGameState, visualTimeUs: number) {
    if (this.layout === null) return null;
    return actorPose(this.layout, state.world.cells, entity.position, visualTimeUs);
  }

  private drawPlayer(actor: DrawnActor, state: PublicGameState, visualTimeUs: number): void {
    const { direction, step } = actorFacing(actor.entity.position, state.world.cells, visualTimeUs);
    const key = conductorTextureKey(direction, step);
    if (!this.scene.textures.exists(key)) {
      this.drawFallbackActor(actor, 0xf2bd67);
      return;
    }
    const image = this.ensureConductor(key);
    this.placeActorSprite(image, key, actor, actor.anchor.y + 10);
  }

  private drawPassenger(actor: DrawnActor, state: PublicGameState, visualTimeUs: number): void {
    const pose = passengerPose(actor.entity.position, state.world.cells, visualTimeUs);
    const layers = npcLayers(actor.entity.appearanceId, actor.entity.id, pose);
    const view = this.ensurePassenger(actor.entity.id);
    if (view === null || !this.scene.textures.exists(layers.body)) {
      view?.body.setVisible(false);
      view?.clothes.setVisible(false);
      view?.eyes.setVisible(false);
      this.drawFallbackActor(
        actor,
        PASSENGER_COLORS[(actor.index - 1) % PASSENGER_COLORS.length] ?? 0x6fb4d4,
      );
      this.placePassengerLabel(view, actor);
      return;
    }
    const depth = actor.anchor.y;
    this.placeActorSprite(view.body, layers.body, actor, depth);
    this.placeActorSprite(view.clothes, layers.clothes, actor, depth + 1);
    if (layers.eyes === null) view.eyes.setVisible(false);
    else this.placeActorSprite(view.eyes, layers.eyes, actor, depth + 2);
    this.placePassengerLabel(view, actor);
  }

  private drawFallbackActor(actor: DrawnActor, color: number): void {
    this.actors
      .fillStyle(color, actor.pose.alpha)
      .fillCircle(actor.pose.x, actor.pose.y, PASSENGER_RADIUS);
    this.actors
      .lineStyle(2, 0x173742, actor.pose.alpha)
      .strokeCircle(actor.pose.x, actor.pose.y, PASSENGER_RADIUS);
  }

  private ensureConductor(key: string): Phaser.GameObjects.Image {
    if (this.conductor === null) {
      this.conductor = this.actorImage(key);
    }
    return this.conductor;
  }

  private ensurePassenger(id: string): PassengerView | null {
    const existing = this.passengers.get(id);
    if (existing !== undefined) return existing;
    const key = 'npc:body:front:0';
    if (!this.scene.textures.exists(key)) return null;
    const view = {
      body: this.actorImage(key),
      clothes: this.actorImage(key),
      eyes: this.actorImage(key),
      label: this.scene.add
        .text(0, 0, '', this.passengerLabelStyle())
        .setOrigin(0.5, 1)
        .setDepth(32),
    };
    view.label.setResolution(Math.max(1, this.viewZoom));
    this.passengers.set(id, view);
    return view;
  }

  private actorImage(key: string): Phaser.GameObjects.Image {
    return this.scene.add
      .image(0, 0, key)
      .setOrigin(0.5, 1)
      .setDisplaySize(ACTOR_DISPLAY_PX, ACTOR_DISPLAY_PX)
      .setVisible(false);
  }

  private placeActorSprite(
    image: Phaser.GameObjects.Image,
    key: string,
    actor: DrawnActor,
    depth: number,
  ): void {
    if (!this.scene.textures.exists(key)) {
      image.setVisible(false);
      return;
    }
    image
      .setTexture(key)
      .setDisplaySize(ACTOR_DISPLAY_PX, ACTOR_DISPLAY_PX)
      .setPosition(actor.anchor.x, actor.anchor.y)
      .setAlpha(actor.pose.alpha)
      .setDepth(1_000 + depth)
      .setVisible(true);
  }

  private placePassengerLabel(view: PassengerView | null, actor: DrawnActor): void {
    if (view === null) return;
    const lift = passengerLabelLift(actor.anchor.x, this.fontPx);
    view.label
      .setText(passengerBadge(actor.index))
      .setPosition(actor.anchor.x, actor.anchor.y - ACTOR_DISPLAY_PX - 4 - lift)
      .setAlpha(actor.pose.alpha)
      .setDepth(1_000 + actor.anchor.y + 6)
      .setVisible(true);
  }

  private passengerLabelStyle(): Phaser.Types.GameObjects.Text.TextStyle {
    return {
      fontFamily: 'Monocraft, monospace',
      fontSize: `${this.fontPx}px`,
      color: '#eef9ff',
      backgroundColor: '#10222cdd',
      align: 'center',
      padding: { x: 4, y: 2 },
    };
  }

  private restylePassengerLabels(): void {
    const style = this.passengerLabelStyle();
    for (const view of this.passengers.values()) {
      view.label.setStyle(style);
      view.label.setResolution(Math.max(1, this.viewZoom));
    }
  }

  private drawHeldItem(actor: DrawnActor): void {
    const held = actor.entity.heldItem;
    if (held === undefined) return;
    const color = this.visuals.heldItem(held.visualId).fillColor;
    const x = actor.anchor.x + 30;
    const y = actor.anchor.y - 40;
    this.heldItems.fillStyle(color, actor.pose.alpha).fillCircle(x, y, 6);
    this.heldItems.lineStyle(2, 0x183440, actor.pose.alpha).strokeCircle(x, y, 6);
  }

  private entityAt(
    state: PublicGameState,
    x: number,
    y: number,
    visualTimeUs: number,
  ): PublicTargetRef | null {
    const hits: { id: string; y: number }[] = [];
    for (const entity of state.entities) {
      const pose = this.poseFor(entity, state, visualTimeUs);
      if (pose === null || pose.alpha <= 0.05) continue;
      const anchor = actorAnchor(pose);
      if (!actorHitContains(x, y, anchor.x, anchor.y)) continue;
      hits.push({ id: entity.id, y: anchor.y });
    }
    hits.sort((left, right) => right.y - left.y);
    const hit = hits[0];
    return hit === undefined ? null : { kind: 'entity', entityId: hit.id };
  }

  private dropMissingPassengers(active: ReadonlySet<string>): void {
    for (const [id, view] of this.passengers) {
      if (active.has(id)) continue;
      destroyPassenger(view);
      this.passengers.delete(id);
    }
  }

  private destroyObjectLabels(): void {
    for (const label of this.objectLabels) label.destroy();
    this.objectLabels.length = 0;
  }

  private destroyPassengers(): void {
    for (const view of this.passengers.values()) destroyPassenger(view);
    this.passengers.clear();
  }
}

interface DrawnActor {
  readonly entity: PublicEntityView;
  readonly pose: { readonly x: number; readonly y: number; readonly alpha: number };
  readonly anchor: { readonly x: number; readonly y: number };
  readonly index: number;
}

function destroyPassenger(view: PassengerView): void {
  view.body.destroy();
  view.clothes.destroy();
  view.eyes.destroy();
  view.label.destroy();
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
