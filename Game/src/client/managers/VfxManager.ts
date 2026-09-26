import type Phaser from 'phaser';
import { anchorFor, tileToScreen } from '../map';
import type { ObservableSnapshot } from '../protocol';

/** Short-lived effects derived only from newly observed public state. */
export class VfxManager {
  private readonly effects = new Set<Phaser.GameObjects.GameObject>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly player: Phaser.GameObjects.Arc,
    private readonly reactFor: (milliseconds: number) => void,
  ) {}

  sync(previous: ObservableSnapshot | null, current: ObservableSnapshot, full: boolean): void {
    if (full || previous === null) return;
    if (
      current.cues.some(
        (cue) => cue.kind === 'whistle' && !previous.cues.some((old) => old.id === cue.id),
      )
    ) {
      const hint = this.scene.add
        .text(this.player.x, this.player.y - 45, 'Свист', {
          color: '#ffe5a7',
          fontFamily: 'Arial',
          fontSize: '19px',
          backgroundColor: '#33434ccc',
          padding: { x: 8, y: 4 },
        })
        .setOrigin(0.5)
        .setDepth(55);
      this.effects.add(hint);
      this.scene.tweens.add({
        targets: hint,
        y: hint.y - 35,
        alpha: 0,
        duration: 1250,
        onComplete: () => this.remove(hint),
      });
    }
    const oldPanel = previous.poi.find((poi) => poi.id === 'panel');
    const newPanel = current.poi.find((poi) => poi.id === 'panel');
    if (newPanel?.observation !== undefined && newPanel.observation !== oldPanel?.observation) {
      this.reactFor(650);
      this.pulseAt('panel', 0xffd39b);
    }
    if (previous.item !== current.item) {
      this.reactFor(650);
      if (current.item === 'used') this.pulseAt('fire-zone', 0xe9f7ff);
      else this.pulseAt('extinguisher', 0xd5f0ff);
    }
  }

  reset(): void {
    for (const effect of this.effects) {
      this.scene.tweens.killTweensOf(effect);
      effect.destroy();
    }
    this.effects.clear();
  }

  destroy(): void {
    this.reset();
  }

  private pulseAt(anchorId: string, color: number): void {
    const tile = anchorFor(anchorId);
    if (tile === undefined) return;
    const point = tileToScreen(tile);
    const pulse = this.scene.add
      .circle(point.x, point.y, 26, color, 0.28)
      .setStrokeStyle(3, color)
      .setDepth(45);
    this.effects.add(pulse);
    this.scene.tweens.add({
      targets: pulse,
      scaleX: 2.1,
      scaleY: 2.1,
      alpha: 0,
      duration: 750,
      onComplete: () => this.remove(pulse),
    });
  }

  private remove(effect: Phaser.GameObjects.GameObject): void {
    effect.destroy();
    this.effects.delete(effect);
  }
}
