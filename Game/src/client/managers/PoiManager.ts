import type Phaser from 'phaser';
import { anchorFor, type Tile, tileToScreen } from '../map';
import type { PoiView } from '../protocol';
import type { InputManager } from './InputManager';

const COLORS: Record<PoiView['kind'], number> = {
  seat: 0x587992,
  door: 0xf1c674,
  panel: 0x64a7ab,
  extinguisher: 0xce765e,
  fire: 0xe17f5c,
  service: 0x79b199,
  toilet: 0x9bb4bd,
};
const SHORT: Record<PoiView['kind'], string> = {
  seat: 'МЕСТО',
  door: 'ДВЕРЬ',
  panel: 'ПАНЕЛЬ',
  extinguisher: 'ОГН',
  fire: 'ОЧАГ',
  service: 'СЕРВИС',
  toilet: 'WC',
};

/** Owns only POIs that the server has made visible. */
export class PoiManager {
  private readonly shapes: Phaser.GameObjects.GameObject[] = [];
  private readonly interactive: Phaser.GameObjects.GameObject[] = [];
  private knownPoi: PoiView[] | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly input: InputManager,
  ) {}

  sync(poi: PoiView[]): void {
    if (poi === this.knownPoi) return;
    this.clear();
    for (const entry of poi) this.createEntry(entry);
    this.knownPoi = poi;
  }

  private createEntry(entry: PoiView): void {
    const visualTile = this.visualTile(entry);
    if (visualTile === null) return;
    const point = tileToScreen(visualTile);
    const width = entry.kind === 'seat' ? 48 : 58;
    const height = entry.kind === 'seat' ? 48 : 52;
    const body = this.scene.add
      .rectangle(point.x, point.y, width, height, COLORS[entry.kind])
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
      const smoke = this.scene.add
        .ellipse(point.x, point.y - 20, 32, 20, 0xd7ded7, 0.5)
        .setDepth(22);
      this.scene.tweens.add({
        targets: smoke,
        y: point.y - 35,
        alpha: 0.16,
        duration: 1100,
        yoyo: true,
        repeat: -1,
      });
      this.scene.tweens.add({
        targets: body,
        scaleX: 1.08,
        scaleY: 1.08,
        duration: 270,
        yoyo: true,
        repeat: -1,
      });
      this.shapes.push(smoke);
    }
    this.input.bindSelectable(body, { kind: 'poi', id: entry.id });
    const tag = this.scene.add
      .text(point.x, point.y, SHORT[entry.kind], {
        fontFamily: 'Arial',
        fontSize: entry.kind === 'seat' ? '10px' : '11px',
        fontStyle: 'bold',
        color: '#102b35',
      })
      .setOrigin(0.5)
      .setDepth(21);
    this.shapes.push(body, tag);
    this.interactive.push(body);
  }

  getVisualTile(id: string): Tile | null {
    const entry = this.knownPoi?.find((poi) => poi.id === id);
    return entry === undefined ? null : this.visualTile(entry);
  }

  reset(): void {
    this.clear();
    this.knownPoi = null;
  }

  destroy(): void {
    this.reset();
  }

  private clear(): void {
    for (const object of this.interactive) this.input.unbind(object);
    this.interactive.length = 0;
    for (const object of this.shapes) {
      this.scene.tweens.killTweensOf(object);
      object.destroy();
    }
    this.shapes.length = 0;
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
}
