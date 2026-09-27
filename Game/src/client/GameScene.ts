import Phaser from 'phaser';

/**
 * Temporary presentation shell.
 *
 * The former zone-based demo client was removed before the authoritative
 * GameAttempt/public-projection integration. New presentation code should be
 * driven only by the new server projection contract.
 */
export class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');
  }

  create(): void {
    const { width, height } = this.scale;

    this.add
      .text(width / 2, height / 2, 'VSM Game\nНовый authoritative runtime подключается отдельно', {
        align: 'center',
        color: '#f2ead6',
        fontFamily: 'Arial, Helvetica, sans-serif',
        fontSize: '22px',
        lineSpacing: 8,
      })
      .setOrigin(0.5);
  }
}
