import Phaser from 'phaser';
import type { ConnectionStatus } from './connection';
import {
  anchorFor,
  closestWalkable,
  findRoute,
  isWalkable,
  MAP_HEIGHT,
  MAP_WIDTH,
  ORIGIN_X,
  ORIGIN_Y,
  screenToTile,
  TILE_SIZE,
  type Tile,
  tileToScreen,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  zoneOf,
} from './map';
import type { NpcView, ObservableSnapshot, PoiView, ZoneId } from './protocol';

export interface Selection {
  kind: 'poi' | 'npc';
  id: string;
}
interface NpcShape {
  body: Phaser.GameObjects.Arc;
  badge: Phaser.GameObjects.Text;
  label: Phaser.GameObjects.Text;
  speech: Phaser.GameObjects.Text;
  tile: Tile;
  route: Tile[];
  sequence: number;
  intent: NpcView['intent']['kind'];
}

const NPC_COLORS = [0x6fb4d4, 0xb894d1, 0x8dc5a3, 0xd7a39a];
// Preserve the time per logical step when changing the old diamond projection to square cells.
const PROJECTION_SPEED_SCALE = TILE_SIZE / Math.hypot(48, 24);
const PLAYER_SPEED = 165 * PROJECTION_SPEED_SCALE;
const NPC_SPEED = 100 * PROJECTION_SPEED_SCALE;

function sameTile(a: Tile, b: Tile): boolean {
  return a.x === b.x && a.y === b.y;
}
function neighbours(tile: Tile): Tile[] {
  return [
    { x: tile.x - 1, y: tile.y },
    { x: tile.x + 1, y: tile.y },
    { x: tile.x, y: tile.y - 1 },
    { x: tile.x, y: tile.y + 1 },
  ];
}
function zoneSpawn(zone: ZoneId): Tile {
  switch (zone) {
    case 'platform':
      return { x: 2, y: 2 };
    case 'vestibule':
      return { x: 3, y: 2 };
    case 'cabin':
      return { x: 6, y: 2 };
    case 'service':
      return { x: 12, y: 2 };
  }
}

export class ClientScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Arc;
  private playerBadge!: Phaser.GameObjects.Text;
  private playerTile: Tile = { x: 2, y: 2 };
  private route: Tile[] = [];
  private routeGoal: Tile | null = null;
  private pendingZone: ZoneId | null = null;
  private deferredAnchor: string | null = null;
  private marker!: Phaser.GameObjects.Arc;
  private selectionRing!: Phaser.GameObjects.Arc;
  private selection: Selection | null = null;
  private npcShapes = new Map<string, NpcShape>();
  private poiShapes: Phaser.GameObjects.GameObject[] = [];
  private knownPoi: PoiView[] | null = null;
  private knownNpcs: NpcView[] | null = null;
  private snapshot: ObservableSnapshot | null = null;
  private snapshotSerial = 0;
  private interactUntil = 0;
  private status: ConnectionStatus = 'connecting';
  private ready = false;

  constructor(
    private readonly select: (selection: Selection) => void,
    private readonly moveZone: (zone: ZoneId) => string | null,
    private readonly say: (message: string) => void,
  ) {
    super('ClientScene');
  }

  create(): void {
    this.playerTile = zoneSpawn(this.snapshot?.playerZone ?? 'platform');
    this.cameras.main.setBackgroundColor('#10232c');
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.drawWorld();
    const start = tileToScreen(this.playerTile);
    this.player = this.add
      .circle(start.x, start.y, 23, 0xf2bd67)
      .setStrokeStyle(4, 0x183440)
      .setDepth(30);
    this.playerBadge = this.add
      .text(start.x, start.y, 'П', {
        fontFamily: 'Arial',
        fontSize: '22px',
        fontStyle: 'bold',
        color: '#183440',
      })
      .setOrigin(0.5)
      .setDepth(31);
    this.marker = this.add
      .circle(start.x, start.y, 29, 0xf1c777, 0.15)
      .setStrokeStyle(3, 0xffe6a1)
      .setDepth(12)
      .setVisible(false);
    this.selectionRing = this.add
      .circle(start.x, start.y, 32, 0xffffff, 0)
      .setStrokeStyle(3, 0xffffff)
      .setDepth(34)
      .setVisible(false);
    this.cameras.main.startFollow(this.player, true, 0.08, 0.08);
    this.resizeCamera();
    this.cameras.main.centerOn(start.x, start.y);
    this.scale.on('resize', () => this.resizeCamera());
    this.input.on(
      Phaser.Input.Events.POINTER_UP,
      (pointer: Phaser.Input.Pointer, over: unknown[]) => {
        if (over.length > 0 || this.status !== 'ready' || this.snapshot?.phase === 'finished')
          return;
        const selected = screenToTile({ x: pointer.worldX, y: pointer.worldY });
        const destination = isWalkable(selected) ? selected : closestWalkable(selected);
        if (destination === null) {
          this.say('Эта точка недоступна.');
          return;
        }
        const plan = this.planRoute(destination);
        if (plan === null) {
          this.say('Нет доступного пути к выбранной точке.');
          return;
        }
        this.route = plan.route;
        this.routeGoal = destination;
        const point = tileToScreen(plan.destination);
        this.marker.setPosition(point.x, point.y).setVisible(true);
        this.say('Проводник идёт по проходу.');
      },
    );
    this.ready = true;
    if (this.snapshot !== null) this.sync(this.snapshot, this.status, '', this.snapshotSerial);
    if (this.deferredAnchor !== null) {
      const anchor = this.deferredAnchor;
      this.deferredAnchor = null;
      this.goToAnchor(anchor);
    }
  }

  override update(_time: number, delta: number): void {
    if (!this.ready) return;
    this.walkPlayer((PLAYER_SPEED * delta) / 1000);
    for (const npc of this.npcShapes.values()) {
      if (npc.route.length > 0) {
        const next = npc.route[0];
        if (
          next !== undefined &&
          !this.isOccupiedForNpc(next, npc) &&
          this.walkShape(npc.body, tileToScreen(next), (NPC_SPEED * delta) / 1000)
        ) {
          npc.tile = next;
          npc.route.shift();
        }
        npc.body.setScale(1.07, 0.94);
      } else {
        npc.body.setScale(1);
      }
      npc.body.setStrokeStyle(
        npc.intent === 'call' || npc.intent === 'react' ? 5 : 3,
        npc.intent === 'call' || npc.intent === 'react' ? 0xf4c36d : 0x173742,
      );
      npc.badge.setPosition(npc.body.x, npc.body.y);
      npc.label.setPosition(npc.body.x, npc.body.y + 27);
      npc.speech.setPosition(npc.body.x, npc.body.y - 47);
    }
    this.playerBadge.setPosition(this.player.x, this.player.y);
    this.updateSelectionRing();
  }

  sync(snapshot: ObservableSnapshot, status: ConnectionStatus, notice = '', serial = 0): void {
    const previous = this.snapshot;
    const isFullSnapshot = serial !== this.snapshotSerial;
    this.snapshotSerial = serial;
    this.snapshot = snapshot;
    this.status = status;
    if (!this.ready) return;
    if (snapshot.phase === 'finished') {
      this.route = [];
      this.routeGoal = null;
    }
    if (isFullSnapshot) this.resetPresentation(snapshot.playerZone);
    if (notice.startsWith('Действие отклонено')) {
      this.route = [];
      this.routeGoal = null;
      this.pendingZone = null;
    }
    if (this.pendingZone === snapshot.playerZone) this.pendingZone = null;
    if (this.knownPoi !== snapshot.poi) this.showPoi(snapshot.poi);
    if (this.knownNpcs !== snapshot.npcs) this.showNpcs(snapshot.npcs);
    if (!isFullSnapshot && previous !== null) this.showObservedEffects(previous, snapshot);
  }

  setStatus(status: ConnectionStatus): void {
    this.status = status;
  }

  highlight(selection: Selection | null): void {
    this.selection = selection;
    if (this.ready) this.updateSelectionRing();
  }

  private updateSelectionRing(): void {
    if (this.selection === null) {
      this.selectionRing.setVisible(false);
      return;
    }
    if (this.selection.kind === 'npc') {
      const npc = this.npcShapes.get(this.selection.id);
      if (npc === undefined) {
        this.selectionRing.setVisible(false);
        return;
      }
      this.selectionRing.setPosition(npc.body.x, npc.body.y).setVisible(true);
      return;
    }
    const poi = this.snapshot?.poi.find((entry) => entry.id === this.selection?.id);
    const tile = poi === undefined ? null : this.visualTile(poi);
    if (tile === null) {
      this.selectionRing.setVisible(false);
      return;
    }
    const point = tileToScreen(tile);
    this.selectionRing.setPosition(point.x, point.y).setVisible(true);
  }

  goToAnchor(id: string): void {
    if (!this.ready) {
      this.deferredAnchor = id;
      return;
    }
    const target = anchorFor(id);
    if (target === undefined) {
      this.say('Точка взаимодействия не найдена.');
      return;
    }
    const plan = this.planRoute(target);
    if (plan === null) {
      this.say('Нет безопасного подхода к объекту.');
      return;
    }
    this.route = plan.route;
    this.routeGoal = target;
    const point = tileToScreen(plan.destination);
    this.marker.setPosition(point.x, point.y).setVisible(true);
  }

  isNear(id: string): boolean {
    const target = anchorFor(id);
    return (
      target !== undefined &&
      Math.abs(target.x - this.playerTile.x) + Math.abs(target.y - this.playerTile.y) <= 1
    );
  }

  private occupiedNpcTiles(): Tile[] {
    return [...this.npcShapes.values()].map((npc) => npc.tile);
  }

  private planRoute(target: Tile): { route: Tile[]; destination: Tile } | null {
    const occupied = this.occupiedNpcTiles();
    const targetIsOccupied = occupied.some((tile) => sameTile(tile, target));
    const candidates = targetIsOccupied || !isWalkable(target) ? neighbours(target) : [target];
    const routes = candidates
      .filter((tile) => isWalkable(tile) && !occupied.some((npcTile) => sameTile(npcTile, tile)))
      .map((destination) => ({
        destination,
        route: findRoute(this.playerTile, destination, occupied),
      }))
      .filter((plan) => plan.route.length > 0 || sameTile(this.playerTile, plan.destination))
      .sort((a, b) => a.route.length - b.route.length);
    return routes[0] ?? null;
  }

  private planNpcRoute(from: Tile, target: Tile, blocked: readonly Tile[]): Tile[] {
    if (sameTile(from, target)) return [];
    const available = (tile: Tile): boolean =>
      isWalkable(tile) && !blocked.some((occupied) => sameTile(occupied, tile));
    const starts = isWalkable(from) ? [from] : neighbours(from).filter(available);
    const ends = isWalkable(target) ? [target] : neighbours(target).filter(available);
    const routes: Tile[][] = [];
    for (const start of starts) {
      for (const end of ends) {
        const middle = findRoute(start, end, blocked);
        if (middle.length === 0 && !sameTile(start, end)) continue;
        routes.push([
          ...(sameTile(start, from) ? [] : [start]),
          ...middle,
          ...(sameTile(end, target) ? [] : [target]),
        ]);
      }
    }
    return routes.sort((a, b) => a.length - b.length)[0] ?? [];
  }

  private isOccupiedForNpc(tile: Tile, current: NpcShape): boolean {
    if (sameTile(tile, this.playerTile)) return true;
    return [...this.npcShapes.values()].some(
      (other) => other !== current && sameTile(other.tile, tile),
    );
  }

  private resetPresentation(zone: ZoneId): void {
    this.route = [];
    this.routeGoal = null;
    this.pendingZone = null;
    this.interactUntil = 0;
    this.playerTile = zoneSpawn(zone);
    const point = tileToScreen(this.playerTile);
    this.player.setPosition(point.x, point.y).setScale(1);
    this.playerBadge.setPosition(point.x, point.y);
    this.resizeCamera();
    this.cameras.main.centerOn(point.x, point.y);
    this.marker.setVisible(false);
    for (const npc of this.npcShapes.values()) {
      npc.body.destroy();
      npc.badge.destroy();
      npc.label.destroy();
      npc.speech.destroy();
    }
    this.npcShapes.clear();
    this.knownNpcs = null;
  }

  private resizeCamera(): void {
    const width = this.scale.width;
    const height = this.scale.height;
    const narrow = width < 760;
    const left = narrow ? 0 : 330;
    const top = narrow ? 166 : 0;
    const bottom = narrow ? 82 : 0;
    const viewportWidth = width - left;
    const viewportHeight = Math.max(220, height - top - bottom);
    this.cameras.main.setViewport(left, top, viewportWidth, viewportHeight);
    this.cameras.main.setZoom(
      narrow
        ? Math.max(0.8, Math.min(1.05, width / 430))
        : Math.max(
            0.72,
            Math.min(1.05, viewportWidth / WORLD_WIDTH, viewportHeight / WORLD_HEIGHT),
          ),
    );
  }

  private drawWorld(): void {
    const graphics = this.add.graphics().setDepth(0);
    const baseX = ORIGIN_X;
    const baseY = ORIGIN_Y;
    const trainX = baseX + 3 * TILE_SIZE;
    const trainWidth = (MAP_WIDTH - 3) * TILE_SIZE;
    const floorColors = {
      platform: 0x68878a,
      vestibule: 0xc1ae81,
      aisle: 0xc8d5ce,
      cabin: 0x7b98a2,
      service: 0x86a898,
      border: 0x263e48,
    };

    graphics
      .fillStyle(0x192f38)
      .fillRect(baseX - 9, baseY - 9, MAP_WIDTH * TILE_SIZE + 18, MAP_HEIGHT * TILE_SIZE + 18);
    for (let x = 0; x < MAP_WIDTH; x += 1) {
      for (let y = 0; y < MAP_HEIGHT; y += 1) {
        const tile = { x, y };
        const fill =
          x <= 2
            ? isWalkable(tile)
              ? floorColors.platform
              : floorColors.border
            : x === 3
              ? isWalkable(tile)
                ? floorColors.vestibule
                : floorColors.border
              : x >= 12
                ? isWalkable(tile)
                  ? floorColors.aisle
                  : floorColors.service
                : y === 2 || y === 3
                  ? floorColors.aisle
                  : floorColors.cabin;
        const px = baseX + x * TILE_SIZE;
        const py = baseY + y * TILE_SIZE;
        graphics.fillStyle(fill).fillRect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);
        graphics
          .lineStyle(1, 0x48616a, 0.6)
          .strokeRect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);
      }
    }

    graphics.lineStyle(8, 0x0c222c).strokeRect(trainX, baseY, trainWidth, MAP_HEIGHT * TILE_SIZE);
    graphics
      .fillStyle(floorColors.vestibule)
      .fillRect(trainX - 5, baseY + 2 * TILE_SIZE + 4, 10, 2 * TILE_SIZE - 8);
    graphics.lineStyle(4, 0xf3ca7d);
    graphics.lineBetween(trainX - 8, baseY + 2 * TILE_SIZE, trainX + 8, baseY + 2 * TILE_SIZE);
    graphics.lineBetween(trainX - 8, baseY + 4 * TILE_SIZE, trainX + 8, baseY + 4 * TILE_SIZE);

    for (let x = 4; x <= 11; x += 1) {
      const centerX = baseX + (x + 0.5) * TILE_SIZE;
      graphics.lineStyle(8, 0xa8d6dc);
      graphics.lineBetween(centerX - 22, baseY + 3, centerX + 22, baseY + 3);
      graphics.lineBetween(
        centerX - 22,
        baseY + MAP_HEIGHT * TILE_SIZE - 3,
        centerX + 22,
        baseY + MAP_HEIGHT * TILE_SIZE - 3,
      );
      if (x !== 5 && x !== 8) {
        const upper = tileToScreen({ x, y: 1 });
        graphics.fillStyle(0x536f83).fillRect(upper.x - 24, upper.y - 22, 48, 44);
        graphics.lineStyle(2, 0xd9e6df).strokeRect(upper.x - 24, upper.y - 22, 48, 44);
      }
      if (x !== 6) {
        const lower = tileToScreen({ x, y: 4 });
        graphics.fillStyle(0x536f83).fillRect(lower.x - 24, lower.y - 22, 48, 44);
        graphics.lineStyle(2, 0xd9e6df).strokeRect(lower.x - 24, lower.y - 22, 48, 44);
      }
    }
    graphics.lineStyle(5, 0x24434e);
    for (const dividerX of [4, 12]) {
      const px = baseX + dividerX * TILE_SIZE;
      graphics.lineBetween(px, baseY + 9, px, baseY + 2 * TILE_SIZE - 8);
      graphics.lineBetween(px, baseY + 4 * TILE_SIZE + 8, px, baseY + 6 * TILE_SIZE - 9);
    }

    this.add
      .text(baseX + TILE_SIZE * 1.5, baseY - 40, 'ПЕРРОН', {
        color: '#dcece7',
        fontFamily: 'Arial',
        fontSize: '19px',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(2);
    this.add
      .text(baseX + TILE_SIZE * 8, baseY - 40, 'ВАГОН 04 · САЛОН', {
        color: '#dcece7',
        fontFamily: 'Arial',
        fontSize: '19px',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(2);
    this.add
      .text(baseX + TILE_SIZE * 12.8, baseY - 40, 'СЕРВИС', {
        color: '#dcece7',
        fontFamily: 'Arial',
        fontSize: '17px',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(2);
  }

  private showPoi(poi: PoiView[]): void {
    for (const item of this.poiShapes) {
      this.tweens.killTweensOf(item);
      item.destroy();
    }
    this.poiShapes = [];
    for (const entry of poi) {
      const visualTile = this.visualTile(entry);
      if (visualTile === null) continue;
      const point = tileToScreen(visualTile);
      const color: Record<PoiView['kind'], number> = {
        seat: 0x587992,
        door: 0xf1c674,
        panel: 0x64a7ab,
        extinguisher: 0xce765e,
        fire: 0xe17f5c,
        service: 0x79b199,
        toilet: 0x9bb4bd,
      };
      const short: Record<PoiView['kind'], string> = {
        seat: 'МЕСТО',
        door: 'ДВЕРЬ',
        panel: 'ПАНЕЛЬ',
        extinguisher: 'ОГН',
        fire: 'ОЧАГ',
        service: 'СЕРВИС',
        toilet: 'WC',
      };
      const width = entry.kind === 'seat' ? 48 : 58;
      const height = entry.kind === 'seat' ? 48 : 52;
      const body = this.add
        .rectangle(point.x, point.y, width, height, color[entry.kind])
        .setStrokeStyle(3, 0x15333d)
        .setDepth(20)
        .setInteractive({ useHandCursor: true });
      if (
        entry.kind === 'panel' &&
        (entry.observation?.includes('отклонение') || entry.observation?.includes('0,72'))
      ) {
        body.setStrokeStyle(5, 0xffd39b);
      }
      if (entry.kind === 'fire') {
        const smoke = this.add.ellipse(point.x, point.y - 20, 32, 20, 0xd7ded7, 0.5).setDepth(22);
        this.tweens.add({
          targets: smoke,
          y: point.y - 35,
          alpha: 0.16,
          duration: 1100,
          yoyo: true,
          repeat: -1,
        });
        this.tweens.add({
          targets: body,
          scaleX: 1.08,
          scaleY: 1.08,
          duration: 270,
          yoyo: true,
          repeat: -1,
        });
        this.poiShapes.push(smoke);
      }
      body.on(Phaser.Input.Events.POINTER_UP, () => this.select({ kind: 'poi', id: entry.id }));
      const tag = this.add
        .text(point.x, point.y, short[entry.kind], {
          fontFamily: 'Arial',
          fontSize: entry.kind === 'seat' ? '10px' : '11px',
          fontStyle: 'bold',
          color: '#102b35',
        })
        .setOrigin(0.5)
        .setDepth(21);
      this.poiShapes.push(body, tag);
    }
    this.knownPoi = poi;
  }

  private visualTile(poi: PoiView): Tile | null {
    const named: Record<string, Tile> = {
      door: { x: 3, y: 1 },
      'seat-1': { x: 5, y: 1 },
      'seat-2': { x: 6, y: 4 },
      'seat-3': { x: 8, y: 1 },
      panel: { x: 9, y: 0 },
      extinguisher: { x: 12, y: 1 },
      'fire-zone': { x: 9, y: 4 },
      service: { x: 12, y: 4 },
      toilet: { x: 13, y: 0 },
    };
    return named[poi.id] ?? anchorFor(poi.id) ?? null;
  }

  private showObservedEffects(previous: ObservableSnapshot, current: ObservableSnapshot): void {
    if (
      current.cues.some(
        (cue) => cue.kind === 'whistle' && !previous.cues.some((old) => old.id === cue.id),
      )
    ) {
      const hint = this.add
        .text(this.player.x, this.player.y - 45, 'Свист', {
          color: '#ffe5a7',
          fontFamily: 'Arial',
          fontSize: '19px',
          backgroundColor: '#33434ccc',
          padding: { x: 8, y: 4 },
        })
        .setOrigin(0.5)
        .setDepth(55);
      this.tweens.add({
        targets: hint,
        y: hint.y - 35,
        alpha: 0,
        duration: 1250,
        onComplete: () => hint.destroy(),
      });
    }
    const oldPanel = previous.poi.find((poi) => poi.id === 'panel');
    const newPanel = current.poi.find((poi) => poi.id === 'panel');
    if (newPanel?.observation !== undefined && newPanel.observation !== oldPanel?.observation) {
      this.interactUntil = this.time.now + 650;
      this.pulseAt('panel', 0xffd39b);
    }
    if (previous.item !== current.item) {
      this.interactUntil = this.time.now + 650;
      if (current.item === 'used') this.pulseAt('fire-zone', 0xe9f7ff);
      else this.pulseAt('extinguisher', 0xd5f0ff);
    }
  }

  private pulseAt(anchorId: string, color: number): void {
    const tile = anchorFor(anchorId);
    if (tile === undefined) return;
    const point = tileToScreen(tile);
    const pulse = this.add
      .circle(point.x, point.y, 26, color, 0.28)
      .setStrokeStyle(3, color)
      .setDepth(45);
    this.tweens.add({
      targets: pulse,
      scaleX: 2.1,
      scaleY: 2.1,
      alpha: 0,
      duration: 750,
      onComplete: () => pulse.destroy(),
    });
  }

  private showNpcs(npcs: NpcView[]): void {
    const active = new Set(npcs.map((entry) => entry.id));
    for (const [id, view] of this.npcShapes) {
      if (active.has(id)) continue;
      view.body.destroy();
      view.badge.destroy();
      view.label.destroy();
      view.speech.destroy();
      this.npcShapes.delete(id);
    }
    npcs.forEach((entry, index) => {
      let view = this.npcShapes.get(entry.id);
      if (view === undefined) {
        const tile = anchorFor(entry.anchorId) ?? { x: 1, y: 2 };
        const point = tileToScreen(tile);
        const body = this.add
          .circle(point.x, point.y, 21, NPC_COLORS[index % NPC_COLORS.length] ?? 0x6fb4d4)
          .setStrokeStyle(3, 0x173742)
          .setDepth(30)
          .setInteractive({ useHandCursor: true });
        body.on(Phaser.Input.Events.POINTER_UP, () => this.select({ kind: 'npc', id: entry.id }));
        const badge = this.add
          .text(point.x, point.y, String(index + 1), {
            fontFamily: 'Arial',
            fontSize: '19px',
            fontStyle: 'bold',
            color: '#173742',
          })
          .setOrigin(0.5)
          .setDepth(31);
        const label = this.add
          .text(point.x, point.y + 27, entry.label, {
            color: '#fff4dc',
            fontFamily: 'Arial',
            fontSize: '13px',
            backgroundColor: '#16313bdd',
            padding: { x: 3, y: 1 },
          })
          .setOrigin(0.5)
          .setDepth(32);
        const speech = this.add
          .text(point.x, point.y - 47, '', {
            color: '#263a3d',
            fontFamily: 'Arial',
            fontSize: '12px',
            backgroundColor: '#f5ead0',
            padding: { x: 6, y: 4 },
            wordWrap: { width: 190 },
          })
          .setOrigin(0.5)
          .setDepth(50)
          .setVisible(false);
        view = { body, badge, label, speech, tile, route: [], sequence: -1, intent: 'wait' };
        this.npcShapes.set(entry.id, view);
      }
      view.speech.setText(entry.speech ?? '').setVisible(entry.speech !== undefined);
      view.intent = entry.intent.kind;
      if (view.sequence !== entry.intent.sequence) {
        const target = anchorFor(entry.intent.targetId);
        view.route =
          target === undefined
            ? []
            : this.planNpcRoute(view.tile, target, [
                this.playerTile,
                ...this.occupiedNpcTiles().filter((tile) => !sameTile(tile, view.tile)),
              ]);
        view.sequence = entry.intent.sequence;
      }
    });
    this.knownNpcs = npcs;
  }

  private walkPlayer(distance: number): void {
    const next = this.route[0];
    if (next === undefined || this.status !== 'ready') {
      this.player.setScale(this.time.now < this.interactUntil ? 1.14 : 1);
      return;
    }
    if (this.occupiedNpcTiles().some((tile) => sameTile(tile, next))) {
      const alternate = this.routeGoal === null ? null : this.planRoute(this.routeGoal);
      if (alternate !== null) this.route = alternate.route;
      this.player.setScale(1);
      return;
    }
    const zone = zoneOf(next);
    if (zone !== this.snapshot?.playerZone) {
      if (this.pendingZone === null) {
        const requestId = this.moveZone(zone);
        if (requestId !== null) this.pendingZone = zone;
      }
      this.player.setScale(1);
      return;
    }
    if (this.walkShape(this.player, tileToScreen(next), distance)) {
      this.playerTile = next;
      this.resizeCamera();
      this.route.shift();
      if (this.route.length === 0) {
        this.routeGoal = null;
        this.marker.setVisible(false);
        this.say('Проводник подошёл к выбранной точке.');
      }
    }
    this.player.setScale(1.08, 0.94);
  }

  private walkShape(
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
}
