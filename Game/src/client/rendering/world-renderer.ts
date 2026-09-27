import type Phaser from 'phaser';
import type {
  PublicEntityView,
  PublicGameState,
  PublicObjectView,
  PublicTargetRef,
  PublicWorldView,
} from '../../common';
import { VisualRegistry } from '../presentation/visual-registry';
import { conductorTextureKey, type Direction, type Step } from './character-art';
import { CELL_SIZE, GridLayout, MAP_HEIGHT, MAP_WIDTH, ORIGIN_X, ORIGIN_Y } from './grid-layout';

type Cell = PublicWorldView['cells'][number];
type Point = { x: number; y: number };

const FLOOR = {
  platform: 0x68878a,
  vestibule: 0xc1ae81,
  aisle: 0xc8d5ce,
  cabin: 0x7b98a2,
  service: 0x86a898,
  border: 0x263e48,
};

const PASSENGER_COLORS = [0x6fb4d4, 0xb894d1, 0x8dc5a3, 0xd7a39a];

const OBJECT_MARKERS: Record<string, { x: number; y: number; label: string; color: number }> = {
  'acceptance-journal': { x: 1, y: 1, label: 'ЖУРНАЛ', color: 0xe3d5b1 },
  'climate-control': { x: 9, y: 0, label: 'ПАНЕЛЬ', color: 0x64a7ab },
  'driver-comms': { x: 10, y: 0, label: 'СВЯЗЬ', color: 0x9bb4bd },
  'emergency-brake': { x: 3, y: 4, label: 'СТОП', color: 0xce765e },
  extinguisher: { x: 12, y: 1, label: 'ОГН', color: 0xce765e },
  'service-point': { x: 12, y: 4, label: 'СЕРВИС', color: 0x79b199 },
};

/** The reference carriage is decoration; visible objects and actors come from the server. */
export class WorldRenderer {
  readonly layout = new GridLayout();
  private readonly floor: Phaser.GameObjects.Graphics;
  private readonly objects: Phaser.GameObjects.Graphics;
  private readonly actors: Phaser.GameObjects.Graphics;
  private readonly heldItems: Phaser.GameObjects.Graphics;
  private readonly sectionLabels: Phaser.GameObjects.Text[];
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
    this.objects = scene.add.graphics().setDepth(20);
    this.actors = scene.add.graphics().setDepth(30);
    this.heldItems = scene.add.graphics().setDepth(40);
    this.sectionLabels = [
      this.sectionLabel(1.5, 'ПЕРРОН'),
      this.sectionLabel(8, 'ВАГОН 04 · САЛОН'),
      this.sectionLabel(12.8, 'СЕРВИС'),
    ];
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
    this.objects.clear();
    this.actors.clear();
    this.heldItems.clear();
    this.conductor?.setVisible(false);
    for (const label of this.sectionLabels) label.setVisible(false);
    for (const label of this.objectLabels) label.destroy();
    this.objectLabels.length = 0;
    for (const labels of this.passengerLabels.values()) {
      labels.badge.destroy();
      labels.name.destroy();
    }
    this.passengerLabels.clear();
    this.previousWorld = null;
  }

  targetAt(
    state: PublicGameState,
    x: number,
    y: number,
    visualTimeUs: number,
  ): PublicTargetRef | null {
    for (const entity of [...state.entities].reverse()) {
      const point = this.entityPoint(entity, state, visualTimeUs);
      if (point !== null && Math.hypot(point.x - x, point.y - y) <= 28)
        return { kind: 'entity', entityId: entity.id };
    }
    const cells = new Map(state.world.cells.map((cell) => [cell.id, cell]));
    for (const object of [...state.world.objects].reverse()) {
      const cell = cells.get(object.cellId);
      if (cell === undefined) continue;
      const point = this.objectPoint(object, cell);
      if (Math.abs(point.x - x) <= 30 && Math.abs(point.y - y) <= 27)
        return { kind: 'object', objectId: object.id };
    }
    return null;
  }

  playerPoint(state: PublicGameState, visualTimeUs: number): Point | null {
    const player = state.entities.find((entity) => entity.kind === 'player');
    return player === undefined ? null : this.entityPoint(player, state, visualTimeUs);
  }

  private sectionLabel(tileX: number, text: string): Phaser.GameObjects.Text {
    return this.scene.add
      .text(ORIGIN_X + tileX * CELL_SIZE, ORIGIN_Y - 40, text, {
        color: '#dcece7',
        fontFamily: 'Arial',
        fontSize: '19px',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(2)
      .setVisible(false);
  }

  private drawWorld(state: PublicGameState): void {
    this.floor.clear();
    this.objects.clear();
    for (const label of this.objectLabels) label.destroy();
    this.objectLabels.length = 0;
    const platformVisible = state.world.regions.some((region) => region.id.includes('platform'));
    this.drawFloor(platformVisible);
    this.drawTrain();
    this.drawSeats();
    this.drawDividers();
    this.drawCellMarkers(state.world.cells);
    this.sectionLabels.forEach((label, index) => {
      label.setVisible(index !== 0 || platformVisible);
    });

    const cells = new Map(state.world.cells.map((cell) => [cell.id, cell]));
    for (const object of state.world.objects) {
      const cell = cells.get(object.cellId);
      if (cell !== undefined) this.drawObject(object, cell);
    }
  }

  private drawFloor(platformVisible: boolean): void {
    this.floor
      .fillStyle(0x192f38)
      .fillRect(
        ORIGIN_X - 9,
        ORIGIN_Y - 9,
        MAP_WIDTH * CELL_SIZE + 18,
        MAP_HEIGHT * CELL_SIZE + 18,
      );
    for (let x = 0; x < MAP_WIDTH; x += 1) {
      for (let y = 0; y < MAP_HEIGHT; y += 1) {
        const point = this.layout.pointFor(x, y);
        const color = floorColor(x, y, platformVisible);
        this.floor
          .fillStyle(color)
          .fillRect(point.x + 2, point.y + 2, CELL_SIZE - 4, CELL_SIZE - 4);
        this.floor
          .lineStyle(1, 0x48616a, 0.6)
          .strokeRect(point.x + 2, point.y + 2, CELL_SIZE - 4, CELL_SIZE - 4);
      }
    }
  }

  private drawTrain(): void {
    const trainX = ORIGIN_X + 3 * CELL_SIZE;
    this.floor
      .lineStyle(8, 0x0c222c)
      .strokeRect(trainX, ORIGIN_Y, (MAP_WIDTH - 3) * CELL_SIZE, MAP_HEIGHT * CELL_SIZE);
    this.floor
      .fillStyle(FLOOR.vestibule)
      .fillRect(trainX - 5, ORIGIN_Y + 2 * CELL_SIZE + 4, 10, 2 * CELL_SIZE - 8);
    this.floor.lineStyle(4, 0xf3ca7d);
    this.floor.lineBetween(
      trainX - 8,
      ORIGIN_Y + 2 * CELL_SIZE,
      trainX + 8,
      ORIGIN_Y + 2 * CELL_SIZE,
    );
    this.floor.lineBetween(
      trainX - 8,
      ORIGIN_Y + 4 * CELL_SIZE,
      trainX + 8,
      ORIGIN_Y + 4 * CELL_SIZE,
    );
  }

  private drawSeats(): void {
    for (let x = 4; x <= 11; x += 1) {
      const centerX = ORIGIN_X + (x + 0.5) * CELL_SIZE;
      this.floor.lineStyle(8, 0xa8d6dc);
      this.floor.lineBetween(centerX - 22, ORIGIN_Y + 3, centerX + 22, ORIGIN_Y + 3);
      this.floor.lineBetween(
        centerX - 22,
        ORIGIN_Y + MAP_HEIGHT * CELL_SIZE - 3,
        centerX + 22,
        ORIGIN_Y + MAP_HEIGHT * CELL_SIZE - 3,
      );
      if (x !== 5 && x !== 8) this.drawSeat(x, 1);
      if (x !== 6) this.drawSeat(x, 4);
    }
  }

  private drawSeat(x: number, y: number): void {
    const point = this.layout.pointFor(x, y);
    const cx = point.x + CELL_SIZE / 2;
    const cy = point.y + CELL_SIZE / 2;
    this.floor.fillStyle(0x536f83).fillRect(cx - 24, cy - 22, 48, 44);
    this.floor.lineStyle(2, 0xd9e6df).strokeRect(cx - 24, cy - 22, 48, 44);
  }

  private drawDividers(): void {
    this.floor.lineStyle(5, 0x24434e);
    for (const dividerX of [4, 12]) {
      const x = ORIGIN_X + dividerX * CELL_SIZE;
      this.floor.lineBetween(x, ORIGIN_Y + 9, x, ORIGIN_Y + 2 * CELL_SIZE - 8);
      this.floor.lineBetween(x, ORIGIN_Y + 4 * CELL_SIZE + 8, x, ORIGIN_Y + 6 * CELL_SIZE - 9);
    }
  }

  private drawCellMarkers(cells: readonly Cell[]): void {
    for (const cell of cells) {
      if (cell.id === 'carriage.entry') this.drawCellMarker(cell, false);
      else if (cell.id.includes('carriage.seat-')) this.drawCellMarker(cell, true);
    }
  }

  private drawCellMarker(cell: Cell, seat: boolean): void {
    const point = seat ? this.layout.centerFor(cell) : this.layout.pointFor(3.5, 1.5);
    const width = seat ? 48 : 58;
    const height = seat ? 48 : 52;
    this.objects
      .fillStyle(seat ? 0x587992 : 0xf1c674)
      .fillRect(point.x - width / 2, point.y - height / 2, width, height);
    this.objects
      .lineStyle(3, 0x15333d)
      .strokeRect(point.x - width / 2, point.y - height / 2, width, height);
    this.objectLabels.push(
      this.scene.add
        .text(point.x, point.y, seat ? 'МЕСТО' : 'ДВЕРЬ', {
          fontFamily: 'Arial',
          fontSize: seat ? '10px' : '11px',
          fontStyle: 'bold',
          color: '#102b35',
        })
        .setOrigin(0.5)
        .setDepth(21),
    );
  }

  private drawObject(object: PublicObjectView, cell: Cell): void {
    const marker = OBJECT_MARKERS[object.kind];
    const point = this.objectPoint(object, cell);
    const color = marker?.color ?? this.visuals.object(object).fillColor;
    const width = object.kind === 'acceptance-journal' ? 54 : 58;
    const height = object.kind === 'acceptance-journal' ? 46 : 52;
    this.objects
      .fillStyle(color)
      .fillRect(point.x - width / 2, point.y - height / 2, width, height);
    this.objects
      .lineStyle(3, 0x15333d)
      .strokeRect(point.x - width / 2, point.y - height / 2, width, height);
    const label = this.scene.add
      .text(point.x, point.y, marker?.label ?? object.kind.toUpperCase(), {
        fontFamily: 'Arial',
        fontSize: '11px',
        fontStyle: 'bold',
        color: '#102b35',
        align: 'center',
        wordWrap: { width: width - 4 },
      })
      .setOrigin(0.5)
      .setDepth(21);
    this.objectLabels.push(label);
  }

  private objectPoint(object: PublicObjectView, cell: Cell): Point {
    const marker = OBJECT_MARKERS[object.kind];
    if (marker === undefined) return this.layout.centerFor(cell);
    const point = this.layout.pointFor(marker.x, marker.y);
    return { x: point.x + CELL_SIZE / 2, y: point.y + CELL_SIZE / 2 };
  }

  private drawEntities(state: PublicGameState, visualTimeUs: number): void {
    this.actors.clear();
    this.heldItems.clear();
    this.conductor?.setVisible(false);
    const activePassengers = new Set<string>();
    let passengerIndex = 0;
    for (const entity of state.entities) {
      const point = this.entityPoint(entity, state, visualTimeUs);
      if (point === null) continue;
      if (entity.kind === 'player') this.drawPlayer(entity, state, point, visualTimeUs);
      else {
        passengerIndex += 1;
        activePassengers.add(entity.id);
        this.drawPassenger(entity, point, passengerIndex);
      }
      if (entity.heldItem !== undefined) this.drawHeldItem(entity, point);
    }
    for (const [id, labels] of this.passengerLabels) {
      if (activePassengers.has(id)) continue;
      labels.badge.destroy();
      labels.name.destroy();
      this.passengerLabels.delete(id);
    }
  }

  private drawPlayer(
    entity: PublicEntityView,
    state: PublicGameState,
    point: Point,
    visualTimeUs: number,
  ): void {
    this.actors.fillStyle(0xf2bd67).fillCircle(point.x, point.y, 27);
    this.actors.lineStyle(4, 0x183440).strokeCircle(point.x, point.y, 27);
    const { direction, step } = conductorFrame(entity, state, visualTimeUs);
    const key = conductorTextureKey(direction, step);
    if (!this.scene.textures.exists(key)) return;
    if (this.conductor === null) {
      this.conductor = this.scene.add.image(point.x, point.y, key).setDepth(31);
      this.conductor.setDisplaySize(58, 58);
    } else {
      this.conductor.setTexture(key).setPosition(point.x, point.y).setVisible(true);
    }
  }

  private drawPassenger(entity: PublicEntityView, point: Point, index: number): void {
    this.actors.fillStyle(PASSENGER_COLORS[(index - 1) % PASSENGER_COLORS.length] ?? 0x6fb4d4);
    this.actors.fillCircle(point.x, point.y, 21);
    this.actors.lineStyle(3, 0x173742).strokeCircle(point.x, point.y, 21);
    let labels = this.passengerLabels.get(entity.id);
    if (labels === undefined) {
      labels = {
        badge: this.scene.add
          .text(point.x, point.y, String(index), {
            fontFamily: 'Arial',
            fontSize: '19px',
            fontStyle: 'bold',
            color: '#173742',
          })
          .setOrigin(0.5)
          .setDepth(31),
        name: this.scene.add
          .text(point.x, point.y + 27, `Пассажир ${index}`, {
            fontFamily: 'Arial',
            fontSize: '13px',
            color: '#fff4dc',
            backgroundColor: '#16313bdd',
            padding: { x: 3, y: 1 },
          })
          .setOrigin(0.5)
          .setDepth(32),
      };
      this.passengerLabels.set(entity.id, labels);
    }
    labels.badge.setText(String(index)).setPosition(point.x, point.y);
    labels.name.setText(`Пассажир ${index}`).setPosition(point.x, point.y + 27);
  }

  private drawHeldItem(entity: PublicEntityView, point: Point): void {
    if (entity.heldItem === undefined) return;
    this.heldItems.fillStyle(this.visuals.heldItem(entity.heldItem.visualId).fillColor);
    this.heldItems.fillCircle(point.x + 23, point.y - 23, 8);
    this.heldItems.lineStyle(2, 0x183440).strokeCircle(point.x + 23, point.y - 23, 8);
  }

  private entityPoint(
    entity: PublicEntityView,
    state: PublicGameState,
    visualTimeUs: number,
  ): Point | null {
    const position = entity.position;
    const fromId =
      position.kind === 'moving'
        ? position.fromCellId
        : position.kind === 'cell'
          ? position.cellId
          : null;
    const from = state.world.cells.find((cell) => cell.id === fromId);
    if (from === undefined) return null;
    const start = this.layout.centerFor(from);
    if (position.kind !== 'moving') return start;
    const to = state.world.cells.find((cell) => cell.id === position.toCellId);
    if (to === undefined) return start;
    const end = this.layout.centerFor(to);
    const duration = position.arrivesAt - position.startedAt;
    const progress =
      duration <= 0 ? 1 : Math.max(0, Math.min(1, (visualTimeUs - position.startedAt) / duration));
    return { x: start.x + (end.x - start.x) * progress, y: start.y + (end.y - start.y) * progress };
  }
}

function floorColor(x: number, y: number, platformVisible: boolean): number {
  const aisle = y === 2 || y === 3;
  if (x <= 2) return platformVisible && y >= 1 && y <= 4 ? FLOOR.platform : FLOOR.border;
  if (x === 3) return aisle ? FLOOR.vestibule : FLOOR.border;
  if (x >= 12) return aisle ? FLOOR.aisle : FLOOR.service;
  return aisle ? FLOOR.aisle : FLOOR.cabin;
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
