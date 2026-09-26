import type Phaser from 'phaser';
import {
  isWalkable,
  MAP_HEIGHT,
  MAP_WIDTH,
  ORIGIN_X,
  ORIGIN_Y,
  TILE_SIZE,
  tileToScreen,
} from '../map';

const FLOOR = {
  platform: 0x68878a,
  vestibule: 0xc1ae81,
  aisle: 0xc8d5ce,
  cabin: 0x7b98a2,
  service: 0x86a898,
  border: 0x263e48,
};

function floorColor(x: number, y: number): number {
  const tile = { x, y };
  if (x <= 2) return isWalkable(tile) ? FLOOR.platform : FLOOR.border;
  if (x === 3) return isWalkable(tile) ? FLOOR.vestibule : FLOOR.border;
  if (x >= 12) return isWalkable(tile) ? FLOOR.aisle : FLOOR.service;
  return y === 2 || y === 3 ? FLOOR.aisle : FLOOR.cabin;
}

/** Owns only the permanent carriage and platform drawing. */
export class WorldManager {
  private readonly objects: Phaser.GameObjects.GameObject[] = [];

  constructor(private readonly scene: Phaser.Scene) {}

  create(): void {
    const graphics = this.scene.add.graphics().setDepth(0);
    this.objects.push(graphics);
    this.drawFloor(graphics);
    this.drawTrain(graphics);
    this.drawSeats(graphics);
    this.drawDividers(graphics);
    this.drawLabels();
  }

  destroy(): void {
    for (const object of this.objects) object.destroy();
    this.objects.length = 0;
  }

  private drawFloor(graphics: Phaser.GameObjects.Graphics): void {
    graphics
      .fillStyle(0x192f38)
      .fillRect(
        ORIGIN_X - 9,
        ORIGIN_Y - 9,
        MAP_WIDTH * TILE_SIZE + 18,
        MAP_HEIGHT * TILE_SIZE + 18,
      );
    for (let x = 0; x < MAP_WIDTH; x += 1) {
      for (let y = 0; y < MAP_HEIGHT; y += 1) {
        const px = ORIGIN_X + x * TILE_SIZE;
        const py = ORIGIN_Y + y * TILE_SIZE;
        graphics.fillStyle(floorColor(x, y)).fillRect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);
        graphics
          .lineStyle(1, 0x48616a, 0.6)
          .strokeRect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);
      }
    }
  }

  private drawTrain(graphics: Phaser.GameObjects.Graphics): void {
    const trainX = ORIGIN_X + 3 * TILE_SIZE;
    const trainWidth = (MAP_WIDTH - 3) * TILE_SIZE;
    graphics
      .lineStyle(8, 0x0c222c)
      .strokeRect(trainX, ORIGIN_Y, trainWidth, MAP_HEIGHT * TILE_SIZE);
    graphics
      .fillStyle(FLOOR.vestibule)
      .fillRect(trainX - 5, ORIGIN_Y + 2 * TILE_SIZE + 4, 10, 2 * TILE_SIZE - 8);
    graphics.lineStyle(4, 0xf3ca7d);
    graphics.lineBetween(
      trainX - 8,
      ORIGIN_Y + 2 * TILE_SIZE,
      trainX + 8,
      ORIGIN_Y + 2 * TILE_SIZE,
    );
    graphics.lineBetween(
      trainX - 8,
      ORIGIN_Y + 4 * TILE_SIZE,
      trainX + 8,
      ORIGIN_Y + 4 * TILE_SIZE,
    );
  }

  private drawSeats(graphics: Phaser.GameObjects.Graphics): void {
    for (let x = 4; x <= 11; x += 1) {
      const centerX = ORIGIN_X + (x + 0.5) * TILE_SIZE;
      graphics.lineStyle(8, 0xa8d6dc);
      graphics.lineBetween(centerX - 22, ORIGIN_Y + 3, centerX + 22, ORIGIN_Y + 3);
      graphics.lineBetween(
        centerX - 22,
        ORIGIN_Y + MAP_HEIGHT * TILE_SIZE - 3,
        centerX + 22,
        ORIGIN_Y + MAP_HEIGHT * TILE_SIZE - 3,
      );
      if (x !== 5 && x !== 8) {
        const upper = tileToScreen({ x, y: 1 });
        graphics.fillStyle(0x536f83).fillRect(upper.x - 24, upper.y - 22, 48, 44);
        graphics.lineStyle(2, 0xd9e6df).strokeRect(upper.x - 24, upper.y - 22, 48, 44);
      }
      if (x !== 6) {
        const lower = tileToScreen({ x, y: 4 });
        graphics.fillStyle(0x536f83).fillRect(lower.x - 24, lower.y - 22, 48, 44);
        graphics.lineStyle(2, 0xd9e6df).strokeRect(lower.x - 24, lower.y - 22, 48, 44);
      }
    }
  }

  private drawDividers(graphics: Phaser.GameObjects.Graphics): void {
    graphics.lineStyle(5, 0x24434e);
    for (const dividerX of [4, 12]) {
      const px = ORIGIN_X + dividerX * TILE_SIZE;
      graphics.lineBetween(px, ORIGIN_Y + 9, px, ORIGIN_Y + 2 * TILE_SIZE - 8);
      graphics.lineBetween(px, ORIGIN_Y + 4 * TILE_SIZE + 8, px, ORIGIN_Y + 6 * TILE_SIZE - 9);
    }
  }

  private drawLabels(): void {
    const platformLabel = this.scene.add
      .text(ORIGIN_X + TILE_SIZE * 1.5, ORIGIN_Y - 40, 'ПЕРРОН', {
        color: '#dcece7',
        fontFamily: 'Arial',
        fontSize: '19px',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(2);
    const cabinLabel = this.scene.add
      .text(ORIGIN_X + TILE_SIZE * 8, ORIGIN_Y - 40, 'ВАГОН 04 · САЛОН', {
        color: '#dcece7',
        fontFamily: 'Arial',
        fontSize: '19px',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(2);
    const serviceLabel = this.scene.add
      .text(ORIGIN_X + TILE_SIZE * 12.8, ORIGIN_Y - 40, 'СЕРВИС', {
        color: '#dcece7',
        fontFamily: 'Arial',
        fontSize: '17px',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(2);
    this.objects.push(platformLabel, cabinLabel, serviceLabel);
  }
}
