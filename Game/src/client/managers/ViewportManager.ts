import type Phaser from 'phaser';
import { WORLD_HEIGHT, WORLD_WIDTH } from '../map';

export class ViewportManager {
  private readonly onResize = (): void => this.resize();

  constructor(
    private readonly scene: Phaser.Scene,
    player: Phaser.GameObjects.Arc,
  ) {
    scene.cameras.main.setBackgroundColor('#10232c');
    scene.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    scene.cameras.main.startFollow(player, true, 0.08, 0.08);
    this.resize();
    scene.scale.on('resize', this.onResize);
  }

  resize(): void {
    const width = this.scene.scale.width;
    const height = this.scene.scale.height;
    const narrow = width <= 760;
    const left = narrow ? 0 : 330;
    const top = narrow ? 166 : 0;
    const bottom = narrow ? 82 : 0;
    const viewportWidth = width - left;
    const viewportHeight = Math.max(220, height - top - bottom);
    this.scene.cameras.main.setViewport(left, top, viewportWidth, viewportHeight);
    this.scene.cameras.main.setZoom(
      narrow
        ? Math.max(0.8, Math.min(1.05, width / 430))
        : Math.max(
            0.72,
            Math.min(1.05, viewportWidth / WORLD_WIDTH, viewportHeight / WORLD_HEIGHT),
          ),
    );
  }

  centerOnPlayer(player: Phaser.GameObjects.Arc): void {
    this.resize();
    this.scene.cameras.main.centerOn(player.x, player.y);
  }

  destroy(): void {
    this.scene.scale.off('resize', this.onResize);
  }
}
