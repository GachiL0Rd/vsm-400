import Phaser from 'phaser';
import type { ConnectionStatus } from './connection';
import {
  anchorFor,
  closestWalkable,
  findRoute,
  isWalkable,
  MAP_HEIGHT,
  MAP_WIDTH,
  screenToTile,
  type Tile,
  tileToScreen,
  zoneOf,
} from './map';
import type { NpcView, ObservableSnapshot, PoiView, ZoneId } from './protocol';

export interface Selection {
  kind: 'poi' | 'npc';
  id: string;
}
interface NpcSprite {
  sprite: Phaser.GameObjects.Sprite;
  label: Phaser.GameObjects.Text;
  speech: Phaser.GameObjects.Text;
  tile: Tile;
  route: Tile[];
  sequence: number;
  intent: NpcView['intent']['kind'];
}

const NPC_TEXTURES = ['passenger_1', 'passenger_2', 'passenger_3', 'passenger_4'];
const PLAYER_SPEED = 165;
const NPC_SPEED = 100;

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
  private player!: Phaser.GameObjects.Sprite;
  private playerTile: Tile = { x: 2, y: 2 };
  private route: Tile[] = [];
  private routeGoal: Tile | null = null;
  private pendingZone: ZoneId | null = null;
  private deferredAnchor: string | null = null;
  private marker!: Phaser.GameObjects.Ellipse;
  private npcSprites = new Map<string, NpcSprite>();
  private poiSprites: Phaser.GameObjects.GameObject[] = [];
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

  preload(): void {
    const sprites = [
      'floor_car',
      'floor_aisle',
      'floor_platform',
      'floor_service',
      'floor_door',
      'seat',
      'window_wall',
      'door',
      'panel',
      'extinguisher',
      'service',
      'toilet',
      'fire',
      'smoke',
    ];
    for (const name of sprites) this.load.image(name, `./sprites/${name}.png`);
    for (const name of ['conductor', ...NPC_TEXTURES]) {
      this.load.spritesheet(name, `./sprites/${name}.png`, { frameWidth: 48, frameHeight: 76 });
    }
  }

  create(): void {
    this.ready = true;
    this.playerTile = zoneSpawn(this.snapshot?.playerZone ?? 'platform');
    this.cameras.main.setBackgroundColor('#132b35');
    this.cameras.main.setBounds(0, 0, 1600, 820);
    this.drawWorld();
    const start = tileToScreen(this.playerTile);
    this.player = this.add
      .sprite(start.x, start.y + 10, 'conductor', 0)
      .setOrigin(0.5, 0.91)
      .setScale(1.2)
      .setDepth(start.y + 20);
    this.marker = this.add
      .ellipse(start.x, start.y + 14, 52, 20, 0xf1c777, 0.35)
      .setStrokeStyle(2, 0xffe6a1)
      .setDepth(start.y + 1)
      .setVisible(false);
    this.cameras.main.startFollow(this.player, true, 0.08, 0.08);
    this.resizeCamera();
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
        this.marker
          .setPosition(point.x, point.y + 14)
          .setDepth(point.y + 1)
          .setVisible(true);
        this.say('Проводник идёт по проходу.');
      },
    );
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
    for (const npc of this.npcSprites.values()) {
      if (npc.route.length > 0) {
        const next = npc.route[0];
        if (
          next !== undefined &&
          !this.isOccupiedForNpc(next, npc) &&
          this.walkSprite(npc.sprite, tileToScreen(next), (NPC_SPEED * delta) / 1000)
        ) {
          npc.tile = next;
          npc.route.shift();
        }
        npc.sprite.setFrame((Math.floor(this.time.now / 220) % 2) + 1);
      } else {
        npc.sprite.setFrame(npc.intent === 'call' || npc.intent === 'react' ? 3 : 0);
      }
      npc.sprite.setDepth(npc.sprite.y + 10);
      npc.label.setPosition(npc.sprite.x, npc.sprite.y - 80).setDepth(npc.sprite.y + 11);
      npc.speech.setPosition(npc.sprite.x, npc.sprite.y - 113).setDepth(npc.sprite.y + 12);
    }
    this.player.setDepth(this.player.y + 10);
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
    this.marker
      .setPosition(point.x, point.y + 14)
      .setDepth(point.y + 1)
      .setVisible(true);
  }

  isNear(id: string): boolean {
    const target = anchorFor(id);
    return (
      target !== undefined &&
      Math.abs(target.x - this.playerTile.x) + Math.abs(target.y - this.playerTile.y) <= 1
    );
  }

  private occupiedNpcTiles(): Tile[] {
    return [...this.npcSprites.values()].map((npc) => npc.tile);
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

  private isOccupiedForNpc(tile: Tile, current: NpcSprite): boolean {
    if (sameTile(tile, this.playerTile)) return true;
    return [...this.npcSprites.values()].some(
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
    this.player
      .setPosition(point.x, point.y + 10)
      .setFrame(0)
      .setFlipX(false);
    this.resizeCamera();
    this.marker.setVisible(false);
    for (const npc of this.npcSprites.values()) {
      npc.sprite.destroy();
      npc.label.destroy();
      npc.speech.destroy();
    }
    this.npcSprites.clear();
    this.knownNpcs = null;
  }

  private resizeCamera(): void {
    const width = this.scale.width;
    const height = this.scale.height;
    this.cameras.main.setZoom(Math.max(0.72, Math.min(1.15, width / 1360, height / 720)));
    this.cameras.main.setFollowOffset(
      width < 760 ? 360 - Math.max(0, this.playerTile.x - 2) * 25 : 0,
      0,
    );
  }

  private drawWorld(): void {
    for (let x = 0; x < MAP_WIDTH; x += 1) {
      for (let y = 0; y < MAP_HEIGHT; y += 1) {
        const tile = { x, y };
        const point = tileToScreen(tile);
        const texture =
          x <= 2
            ? 'floor_platform'
            : x === 3
              ? 'floor_door'
              : x >= 12
                ? 'floor_service'
                : y === 2 || y === 3
                  ? 'floor_aisle'
                  : 'floor_car';
        this.add.image(point.x, point.y, texture).setOrigin(0.5, 0).setDepth(0);
      }
    }
    for (let x = 4; x <= 11; x += 1) {
      const wallPoint = tileToScreen({ x, y: 0 });
      this.add
        .image(wallPoint.x, wallPoint.y + 21, 'window_wall')
        .setOrigin(0.5, 0.91)
        .setDepth(wallPoint.y + 2);
      if (x !== 5 && x !== 8) {
        const upper = tileToScreen({ x, y: 1 });
        this.add
          .image(upper.x, upper.y + 24, 'seat')
          .setOrigin(0.5, 0.9)
          .setDepth(upper.y + 7);
      }
      if (x !== 6) {
        const lower = tileToScreen({ x, y: 4 });
        this.add
          .image(lower.x, lower.y + 23, 'seat')
          .setOrigin(0.5, 0.9)
          .setDepth(lower.y + 7);
      }
    }
    this.add
      .text(475, 200, 'ПЕРРОН', {
        color: '#e9f1e5',
        fontFamily: 'Arial',
        fontSize: '24px',
        fontStyle: 'bold',
      })
      .setDepth(500);
    this.add
      .text(1035, 200, 'ВАГОН 04', {
        color: '#e9f1e5',
        fontFamily: 'Arial',
        fontSize: '25px',
        fontStyle: 'bold',
      })
      .setDepth(500);
  }

  private showPoi(poi: PoiView[]): void {
    for (const item of this.poiSprites) {
      this.tweens.killTweensOf(item);
      item.destroy();
    }
    this.poiSprites = [];
    for (const entry of poi) {
      const visualTile = this.visualTile(entry);
      if (visualTile === null) continue;
      const point = tileToScreen(visualTile);
      const texture =
        entry.kind === 'seat'
          ? 'seat'
          : entry.kind === 'door'
            ? 'door'
            : entry.kind === 'panel'
              ? 'panel'
              : entry.kind === 'extinguisher'
                ? 'extinguisher'
                : entry.kind === 'fire'
                  ? 'fire'
                  : entry.kind === 'toilet'
                    ? 'toilet'
                    : 'service';
      const image = this.add
        .image(point.x, point.y + 23, texture)
        .setOrigin(0.5, 0.91)
        .setDepth(point.y + 8)
        .setInteractive({ useHandCursor: true });
      if (
        entry.kind === 'panel' &&
        (entry.observation?.includes('отклонение') || entry.observation?.includes('0,72'))
      ) {
        image.setTint(0xffd39b);
      }
      if (entry.kind === 'fire') {
        const smoke = this.add
          .image(point.x, point.y - 7, 'smoke')
          .setOrigin(0.5, 0.9)
          .setAlpha(0.55)
          .setDepth(point.y + 10);
        this.tweens.add({
          targets: smoke,
          y: point.y - 25,
          alpha: 0.22,
          duration: 1100,
          yoyo: true,
          repeat: -1,
        });
        this.tweens.add({
          targets: image,
          scaleX: 1.08,
          scaleY: 1.13,
          duration: 270,
          yoyo: true,
          repeat: -1,
        });
        this.poiSprites.push(smoke);
      }
      image.on(Phaser.Input.Events.POINTER_UP, () => this.select({ kind: 'poi', id: entry.id }));
      const label = this.add
        .text(point.x, point.y - 39, entry.label, {
          fontFamily: 'Arial',
          fontSize: '13px',
          color: '#f7efe1',
          backgroundColor: '#16313bcc',
          padding: { x: 5, y: 3 },
        })
        .setOrigin(0.5)
        .setDepth(point.y + 9);
      this.poiSprites.push(image, label);
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
        .text(this.player.x, this.player.y - 95, 'Свист', {
          color: '#ffe5a7',
          fontFamily: 'Arial',
          fontSize: '19px',
          backgroundColor: '#33434ccc',
          padding: { x: 8, y: 4 },
        })
        .setOrigin(0.5)
        .setDepth(this.player.depth + 30);
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
      .ellipse(point.x, point.y + 9, 48, 22, color, 0.65)
      .setStrokeStyle(3, color)
      .setDepth(point.y + 15);
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
    for (const [id, view] of this.npcSprites) {
      if (active.has(id)) continue;
      view.sprite.destroy();
      view.label.destroy();
      view.speech.destroy();
      this.npcSprites.delete(id);
    }
    npcs.forEach((entry, index) => {
      let view = this.npcSprites.get(entry.id);
      if (view === undefined) {
        const tile = anchorFor(entry.anchorId) ?? { x: 1, y: 2 };
        const point = tileToScreen(tile);
        const sprite = this.add
          .sprite(
            point.x,
            point.y + 10,
            NPC_TEXTURES[index % NPC_TEXTURES.length] ?? 'passenger_1',
            0,
          )
          .setOrigin(0.5, 0.91)
          .setScale(1.13)
          .setDepth(point.y + 10)
          .setInteractive({ useHandCursor: true });
        sprite.on(Phaser.Input.Events.POINTER_UP, () => this.select({ kind: 'npc', id: entry.id }));
        const label = this.add
          .text(point.x, point.y - 80, entry.label, {
            color: '#fff4dc',
            fontFamily: 'Arial',
            fontSize: '15px',
            backgroundColor: '#16313bdd',
            padding: { x: 5, y: 2 },
          })
          .setOrigin(0.5);
        const speech = this.add
          .text(point.x, point.y - 113, '', {
            color: '#263a3d',
            fontFamily: 'Arial',
            fontSize: '13px',
            backgroundColor: '#f5ead0',
            padding: { x: 6, y: 4 },
          })
          .setOrigin(0.5)
          .setVisible(false);
        view = { sprite, label, speech, tile, route: [], sequence: -1, intent: 'wait' };
        this.npcSprites.set(entry.id, view);
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
      this.player.setFrame(this.time.now < this.interactUntil ? 3 : 0);
      return;
    }
    if (this.occupiedNpcTiles().some((tile) => sameTile(tile, next))) {
      const alternate = this.routeGoal === null ? null : this.planRoute(this.routeGoal);
      if (alternate !== null) this.route = alternate.route;
      this.player.setFrame(0);
      return;
    }
    const zone = zoneOf(next);
    if (zone !== this.snapshot?.playerZone) {
      if (this.pendingZone === null) {
        const requestId = this.moveZone(zone);
        if (requestId !== null) this.pendingZone = zone;
      }
      this.player.setFrame(0);
      return;
    }
    if (this.walkSprite(this.player, tileToScreen(next), distance)) {
      this.playerTile = next;
      this.resizeCamera();
      this.route.shift();
      if (this.route.length === 0) {
        this.routeGoal = null;
        this.marker.setVisible(false);
        this.say('Проводник подошёл к выбранной точке.');
      }
    }
    this.player.setFrame((Math.floor(this.time.now / 190) % 2) + 1);
  }

  private walkSprite(
    sprite: Phaser.GameObjects.Sprite,
    target: { x: number; y: number },
    distance: number,
  ): boolean {
    const dx = target.x - sprite.x;
    const dy = target.y + 10 - sprite.y;
    if (Math.abs(dx) > 1) sprite.setFlipX(dx < 0);
    const length = Math.hypot(dx, dy);
    if (length <= distance) {
      sprite.setPosition(target.x, target.y + 10);
      return true;
    }
    sprite.setPosition(sprite.x + (dx / length) * distance, sprite.y + (dy / length) * distance);
    return false;
  }
}
