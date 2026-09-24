import Phaser from 'phaser';

class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  create(): void {
    const label = this.add
      .text(0, 0, 'Phaser ready', {
        color: '#ffffff',
        fontFamily: 'Arial, sans-serif',
        fontSize: '24px',
      })
      .setOrigin(0.5);

    const centerLabel = (size: { width: number; height: number }): void => {
      label.setPosition(size.width / 2, size.height / 2);
    };

    centerLabel(this.scale.gameSize);
    this.scale.on(Phaser.Scale.Events.RESIZE, centerLabel);
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: window.innerWidth,
  height: window.innerHeight,
  backgroundColor: '#10151c',
  scale: {
    mode: Phaser.Scale.RESIZE,
  },
  scene: [BootScene],
});
