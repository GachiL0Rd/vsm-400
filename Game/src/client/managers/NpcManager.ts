import type Phaser from 'phaser';
import { anchorFor, TILE_SIZE, type Tile, tileToScreen } from '../map';
import { walkShape } from '../movement';
import type { NpcView } from '../protocol';
import type { CollisionManager } from './CollisionManager';
import type { InputManager } from './InputManager';

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
const NPC_SPEED = 100 * (TILE_SIZE / Math.hypot(48, 24));

/** Presents observed NPC intent; it never chooses an NPC action. */
export class NpcManager {
  private readonly shapes = new Map<string, NpcShape>();
  private knownNpcs: NpcView[] | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly collision: CollisionManager,
    private readonly input: InputManager,
  ) {}

  getTiles(): ReadonlyMap<string, Tile> {
    return new Map([...this.shapes].map(([id, shape]) => [id, shape.tile]));
  }

  getBody(id: string): Phaser.GameObjects.Arc | undefined {
    return this.shapes.get(id)?.body;
  }

  sync(npcs: NpcView[]): void {
    if (npcs === this.knownNpcs) return;
    const active = new Set(npcs.map((entry) => entry.id));
    for (const [id, view] of this.shapes) {
      if (active.has(id)) continue;
      this.destroyShape(view);
      this.shapes.delete(id);
    }
    npcs.forEach((entry, index) => {
      let view = this.shapes.get(entry.id);
      if (view === undefined) {
        const tile = anchorFor(entry.anchorId) ?? { x: 1, y: 2 };
        const point = tileToScreen(tile);
        const body = this.scene.add
          .circle(point.x, point.y, 21, NPC_COLORS[index % NPC_COLORS.length] ?? 0x6fb4d4)
          .setStrokeStyle(3, 0x173742)
          .setDepth(30)
          .setInteractive({ useHandCursor: true });
        this.input.bindSelectable(body, { kind: 'npc', id: entry.id });
        const badge = this.scene.add
          .text(point.x, point.y, String(index + 1), {
            fontFamily: 'Arial',
            fontSize: '19px',
            fontStyle: 'bold',
            color: '#173742',
          })
          .setOrigin(0.5)
          .setDepth(31);
        const label = this.scene.add
          .text(point.x, point.y + 27, entry.label, {
            color: '#fff4dc',
            fontFamily: 'Arial',
            fontSize: '13px',
            backgroundColor: '#16313bdd',
            padding: { x: 3, y: 1 },
          })
          .setOrigin(0.5)
          .setDepth(32);
        const speech = this.scene.add
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
        this.shapes.set(entry.id, view);
      }
      view.speech.setText(entry.speech ?? '').setVisible(entry.speech !== undefined);
      view.intent = entry.intent.kind;
      if (view.sequence !== entry.intent.sequence) {
        const target = anchorFor(entry.intent.targetId);
        view.route =
          target === undefined ? [] : this.collision.planNpcRoute(view.tile, target, entry.id);
        view.sequence = entry.intent.sequence;
      }
    });
    this.knownNpcs = npcs;
  }

  update(delta: number): void {
    for (const [id, npc] of this.shapes) {
      if (npc.route.length > 0) {
        const next = npc.route[0];
        if (
          next !== undefined &&
          !this.collision.isOccupiedForNpc(next, id) &&
          walkShape(npc.body, tileToScreen(next), (NPC_SPEED * delta) / 1000)
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
  }

  reset(): void {
    for (const shape of this.shapes.values()) this.destroyShape(shape);
    this.shapes.clear();
    this.knownNpcs = null;
  }

  destroy(): void {
    this.reset();
  }

  private destroyShape(shape: NpcShape): void {
    this.input.unbind(shape.body);
    shape.body.destroy();
    shape.badge.destroy();
    shape.label.destroy();
    shape.speech.destroy();
  }
}
