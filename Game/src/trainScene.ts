import Phaser from 'phaser';
import type { LessonId } from './domain/scenarios';

function drawPerson(
  scene: Phaser.Scene,
  x: number,
  shirt: number,
  skin: number,
  label: string,
): void {
  const shadow = scene.add.ellipse(x, 191, 102, 12, 0x415c75, 0.13);
  shadow.setDepth(1);

  const body = scene.add.graphics();
  body.fillStyle(shirt);
  body.fillRoundedRect(x - 37, 111, 74, 79, 28);
  body.fillStyle(skin);
  body.fillCircle(x, 90, 29);
  body.fillStyle(0x23324f);
  body.fillCircle(x - 10, 88, 2);
  body.fillCircle(x + 10, 88, 2);
  body.setDepth(2);

  scene.add
    .text(x, 205, label, {
      color: '#31546d',
      fontFamily: 'Arial, sans-serif',
      fontSize: '13px',
      fontStyle: 'bold',
    })
    .setOrigin(0.5)
    .setDepth(3);
}

class TrainScene extends Phaser.Scene {
  private readonly lessonId: LessonId;

  constructor(lessonId: LessonId) {
    super('TrainScene');
    this.lessonId = lessonId;
  }

  create(): void {
    const canvas = this.add.graphics();
    canvas.fillStyle(0xeaf6ff);
    canvas.fillRect(0, 0, 800, 240);

    // A stylised train interior keeps the scene legible without external assets.
    canvas.fillStyle(0xd3e9fa);
    canvas.fillRoundedRect(250, 18, 300, 114, 18);
    canvas.fillStyle(0x9bd3f4);
    canvas.fillRoundedRect(259, 27, 282, 96, 12);
    canvas.fillStyle(0xe7f8ff);
    canvas.fillRoundedRect(278, 35, 146, 28, 14);
    canvas.fillStyle(0xb7d9e6);
    canvas.fillRect(259, 103, 282, 20);
    canvas.fillStyle(0x8db8c4);
    canvas.fillRect(258, 117, 283, 7);
    canvas.fillStyle(0xc7e2ed);
    canvas.fillRect(0, 179, 800, 61);
    canvas.lineStyle(4, 0xaccad7);
    canvas.strokeLineShape(new Phaser.Geom.Line(0, 178, 800, 178));
    canvas.fillStyle(0xffffff);
    canvas.fillRoundedRect(274, 126, 252, 8, 4);

    const cloud = this.add.ellipse(340, 55, 73, 17, 0xffffff, 0.7);
    this.tweens.add({ targets: cloud, x: 390, duration: 4000, yoyo: true, repeat: -1 });

    drawPerson(this, 152, 0x5772e6, 0xffd8b2, 'ПАССАЖИР');
    drawPerson(this, 648, 0x19a5a5, 0xf4c69d, 'ПРОВОДНИК');

    if (this.lessonId === 'aisle') {
      const bag = this.add.graphics();
      bag.fillStyle(0xf6ad55);
      bag.fillRoundedRect(351, 151, 98, 43, 9);
      bag.lineStyle(5, 0x9e5628);
      bag.strokeRoundedRect(375, 137, 50, 21, 8);
      bag.fillStyle(0x9e5628);
      bag.fillRoundedRect(360, 189, 12, 8, 3);
      bag.fillRoundedRect(428, 189, 12, 8, 3);
      this.add
        .text(400, 166, '!', { color: '#ffffff', fontSize: '27px', fontStyle: 'bold' })
        .setOrigin(0.5);
    } else if (this.lessonId === 'call-button') {
      const panel = this.add.graphics();
      panel.fillStyle(0xffffff);
      panel.fillRoundedRect(349, 136, 102, 66, 13);
      panel.lineStyle(3, 0xb5ccdc);
      panel.strokeRoundedRect(349, 136, 102, 66, 13);
      panel.fillStyle(0xfa7771);
      panel.fillCircle(400, 168, 19);
      this.add.text(400, 166, '✕', { color: '#ffffff', fontSize: '22px' }).setOrigin(0.5);
    } else {
      const sign = this.add.graphics();
      sign.fillStyle(0xffffff);
      sign.fillRoundedRect(337, 144, 126, 48, 12);
      sign.lineStyle(3, 0xb5ccdc);
      sign.strokeRoundedRect(337, 144, 126, 48, 12);
      this.add
        .text(400, 166, 'К МЕСТУ  →', {
          color: '#3d6083',
          fontFamily: 'Arial, sans-serif',
          fontSize: '18px',
          fontStyle: 'bold',
        })
        .setOrigin(0.5);
    }
  }
}

export function mountTrainScene(parent: string, lessonId: LessonId): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: 800,
    height: 240,
    transparent: true,
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: [new TrainScene(lessonId)],
  });
}
