import type Phaser from 'phaser';
import type { ConnectionStatus } from '../connection';
import {
  anchorFor,
  closestWalkable,
  isWalkable,
  sameTile,
  TILE_SIZE,
  type Tile,
  tileToScreen,
  zoneOf,
} from '../map';
import { walkShape } from '../movement';
import type { ObservableSnapshot, ZoneId } from '../protocol';
import type { CollisionManager } from './CollisionManager';

// Preserve the time per logical step after the square-cell projection change.
const PROJECTION_SPEED_SCALE = TILE_SIZE / Math.hypot(48, 24);
const PLAYER_SPEED = 165 * PROJECTION_SPEED_SCALE;

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

export class PlayerManager {
  readonly body: Phaser.GameObjects.Arc;
  private readonly badge: Phaser.GameObjects.Text;
  private readonly marker: Phaser.GameObjects.Arc;
  private tile: Tile = { x: 2, y: 2 };
  private route: Tile[] = [];
  private routeGoal: Tile | null = null;
  private pendingZone: ZoneId | null = null;
  private status: ConnectionStatus = 'connecting';
  private snapshot: ObservableSnapshot | null = null;
  private interactUntil = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly collision: CollisionManager,
    private readonly moveZone: (zone: ZoneId) => string | null,
    private readonly say: (message: string) => void,
    private readonly onTileChanged: () => void,
  ) {
    const start = tileToScreen(this.tile);
    this.body = scene.add
      .circle(start.x, start.y, 23, 0xf2bd67)
      .setStrokeStyle(4, 0x183440)
      .setDepth(30);
    this.badge = scene.add
      .text(start.x, start.y, 'П', {
        fontFamily: 'Arial',
        fontSize: '22px',
        fontStyle: 'bold',
        color: '#183440',
      })
      .setOrigin(0.5)
      .setDepth(31);
    this.marker = scene.add
      .circle(start.x, start.y, 29, 0xf1c777, 0.15)
      .setStrokeStyle(3, 0xffe6a1)
      .setDepth(12)
      .setVisible(false);
  }

  getTile(): Tile {
    return this.tile;
  }

  isNear(id: string): boolean {
    const target = anchorFor(id);
    return (
      target !== undefined &&
      Math.abs(target.x - this.tile.x) + Math.abs(target.y - this.tile.y) <= 1
    );
  }

  setStatus(status: ConnectionStatus): void {
    this.status = status;
  }

  sync(snapshot: ObservableSnapshot, status: ConnectionStatus, notice: string): void {
    this.snapshot = snapshot;
    this.status = status;
    if (snapshot.phase === 'finished') this.clearRoute();
    if (notice.startsWith('Действие отклонено')) {
      this.clearRoute();
      this.pendingZone = null;
    }
    if (this.pendingZone === snapshot.playerZone) this.pendingZone = null;
  }

  reset(zone: ZoneId): void {
    this.clearRoute();
    this.pendingZone = null;
    this.interactUntil = 0;
    this.tile = zoneSpawn(zone);
    const point = tileToScreen(this.tile);
    this.body.setPosition(point.x, point.y).setScale(1);
    this.badge.setPosition(point.x, point.y);
    this.onTileChanged();
  }

  reactFor(milliseconds: number): void {
    this.interactUntil = this.scene.time.now + milliseconds;
  }

  moveToTile(selected: Tile): void {
    if (this.status !== 'ready' || this.snapshot?.phase === 'finished') return;
    const destination = isWalkable(selected) ? selected : closestWalkable(selected);
    if (destination === null) {
      this.say('Эта точка недоступна.');
      return;
    }
    const plan = this.collision.planPlayerRoute(this.tile, destination);
    if (plan === null) {
      this.say('Нет доступного пути к выбранной точке.');
      return;
    }
    this.setRoute(plan.route, destination, plan.destination);
    this.say('Проводник идёт по проходу.');
  }

  goToAnchor(id: string): void {
    const target = anchorFor(id);
    if (target === undefined) {
      this.say('Точка взаимодействия не найдена.');
      return;
    }
    const plan = this.collision.planPlayerRoute(this.tile, target);
    if (plan === null) {
      this.say('Нет безопасного подхода к объекту.');
      return;
    }
    this.setRoute(plan.route, target, plan.destination);
  }

  update(delta: number): void {
    const next = this.route[0];
    if (next === undefined || this.status !== 'ready') {
      this.body.setScale(this.scene.time.now < this.interactUntil ? 1.14 : 1);
      this.badge.setPosition(this.body.x, this.body.y);
      return;
    }
    if (this.waitForBlockOrZone(next)) return;
    if (walkShape(this.body, tileToScreen(next), (PLAYER_SPEED * delta) / 1000)) {
      this.tile = next;
      this.onTileChanged();
      this.route.shift();
      if (this.route.length === 0) {
        this.routeGoal = null;
        this.marker.setVisible(false);
        this.say('Проводник подошёл к выбранной точке.');
      }
    }
    this.body.setScale(1.08, 0.94);
    this.badge.setPosition(this.body.x, this.body.y);
  }

  destroy(): void {
    this.body.destroy();
    this.badge.destroy();
    this.marker.destroy();
  }

  private setRoute(route: Tile[], goal: Tile, destination: Tile): void {
    this.route = route;
    this.routeGoal = goal;
    const point = tileToScreen(destination);
    this.marker.setPosition(point.x, point.y).setVisible(true);
  }

  private waitForBlockOrZone(next: Tile): boolean {
    if (this.collision.occupiedNpcTiles().some((tile) => sameTile(tile, next))) {
      const alternate =
        this.routeGoal === null ? null : this.collision.planPlayerRoute(this.tile, this.routeGoal);
      if (alternate !== null) this.route = alternate.route;
      this.body.setScale(1);
      return true;
    }
    const zone = zoneOf(next);
    if (zone === this.snapshot?.playerZone) return false;
    if (this.pendingZone === null) {
      const requestId = this.moveZone(zone);
      if (requestId !== null) this.pendingZone = zone;
    }
    this.body.setScale(1);
    return true;
  }

  private clearRoute(): void {
    this.route = [];
    this.routeGoal = null;
    this.marker.setVisible(false);
  }
}
