import type Phaser from 'phaser';
import type { CommandInput } from '../connection';
import { addLine, button, node } from '../dom';
import { type Tile, tileToScreen } from '../map';
import type { ActionView, NpcView, ObservableSnapshot, PoiView } from '../protocol';
import type { Selection } from '../selection';

/** Owns the single selection, its ring and the contextual action card. */
export class InteractionManager {
  private readonly ring: Phaser.GameObjects.Arc;
  private selection: Selection | null = null;
  private snapshot: ObservableSnapshot | null = null;
  private lastPoi: PoiView[] | null = null;
  private lastNpcs: NpcView[] | null = null;
  private lastItem: ObservableSnapshot['item'] | null = null;

  constructor(
    scene: Phaser.Scene,
    private readonly root: HTMLElement,
    private readonly getNpcBody: (id: string) => Phaser.GameObjects.Arc | undefined,
    private readonly getPoiTile: (id: string) => Tile | null,
    private readonly isNear: (id: string) => boolean,
    private readonly goToAnchor: (id: string) => void,
    private readonly send: (input: CommandInput) => void,
  ) {
    this.ring = scene.add
      .circle(0, 0, 32, 0xffffff, 0)
      .setStrokeStyle(3, 0xffffff)
      .setDepth(34)
      .setVisible(false);
    this.renderDetails();
  }

  select(selection: Selection): void {
    if (this.snapshot?.debrief !== null && this.snapshot?.debrief !== undefined) return;
    this.selection = selection;
    this.updateRing();
    this.renderDetails();
  }

  sync(snapshot: ObservableSnapshot): void {
    this.snapshot = snapshot;
    if (snapshot.debrief !== null) {
      this.selection = null;
      this.ring.setVisible(false);
      this.root.replaceChildren();
      return;
    }
    if (
      snapshot.poi !== this.lastPoi ||
      snapshot.npcs !== this.lastNpcs ||
      snapshot.item !== this.lastItem
    ) {
      this.renderDetails();
      this.updateRing();
    }
    this.lastPoi = snapshot.poi;
    this.lastNpcs = snapshot.npcs;
    this.lastItem = snapshot.item;
  }

  refresh(): void {
    this.renderDetails();
  }

  update(): void {
    this.updateRing();
  }

  reset(): void {
    this.selection = null;
    this.snapshot = null;
    this.lastPoi = null;
    this.lastNpcs = null;
    this.lastItem = null;
    this.ring.setVisible(false);
    this.renderDetails();
  }

  destroy(): void {
    this.ring.destroy();
    this.root.replaceChildren();
  }

  private updateRing(): void {
    const selection = this.selection;
    if (selection === null) {
      this.ring.setVisible(false);
      return;
    }
    if (selection.kind === 'npc') {
      const body = this.getNpcBody(selection.id);
      if (body === undefined) {
        this.ring.setVisible(false);
        return;
      }
      this.ring.setPosition(body.x, body.y).setVisible(true);
      return;
    }
    const tile = this.getPoiTile(selection.id);
    if (tile === null) {
      this.ring.setVisible(false);
      return;
    }
    const point = tileToScreen(tile);
    this.ring.setPosition(point.x, point.y).setVisible(true);
  }

  private renderDetails(): void {
    this.root.replaceChildren();
    const snapshot = this.snapshot;
    if (snapshot?.debrief !== null && snapshot?.debrief !== undefined) return;
    const selection = this.selection;
    if (snapshot === null || selection === null) {
      addLine(
        this.root,
        'Кликните по пассажиру или объекту. Клик по полу задаёт маршрут.',
        'muted',
      );
      return;
    }
    const poi =
      selection.kind === 'poi'
        ? snapshot.poi.find((entry) => entry.id === selection.id)
        : undefined;
    const npc =
      selection.kind === 'npc'
        ? snapshot.npcs.find((entry) => entry.id === selection.id)
        : undefined;
    if (poi === undefined && npc === undefined) {
      this.selection = null;
      this.ring.setVisible(false);
      return;
    }
    const target: PoiView | NpcView = poi ?? (npc as NpcView);
    const anchor = npc?.intent.targetId ?? npc?.anchorId ?? target.id;
    this.root.append(node('h2', '', target.label));
    if (poi?.observation !== undefined) addLine(this.root, poi.observation, 'observation');
    if (npc?.speech !== undefined) addLine(this.root, `— ${npc.speech}`, 'observation');
    this.appendAvailableActions(target, anchor);
    this.root.append(
      button('Закрыть', () => {
        this.selection = null;
        this.ring.setVisible(false);
        this.renderDetails();
      }),
    );
  }

  private appendAvailableActions(target: PoiView | NpcView, anchor: string): void {
    if (!this.isNear(anchor)) {
      this.root.append(button('Подойти', () => this.goToAnchor(anchor)));
      addLine(this.root, 'Для действия сначала подойдите к объекту.', 'muted');
      return;
    }
    for (const action of target.actions) this.root.append(this.actionButton(action, target.id));
  }

  private actionButton(action: ActionView, targetId: string): HTMLButtonElement {
    const input: CommandInput =
      action.kind === 'inspect'
        ? { kind: 'inspect', targetId, inspection: action.id === 'full' ? 'full' : 'quick' }
        : { kind: action.kind, targetId };
    const label = action.enabled
      ? action.label
      : `${action.label} · ${action.disabledReason ?? 'недоступно'}`;
    return button(label, () => this.send(input), !action.enabled);
  }
}
