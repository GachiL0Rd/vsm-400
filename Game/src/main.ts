import Phaser from 'phaser';
import {
  advanceWorld,
  createWorldState,
  setWorldSpeed,
  type WorldSpeed,
  type WorldState,
} from './world';

type Point = Phaser.Math.Vector2;

const WORLD_WIDTH = 1800;
const WORLD_HEIGHT = 760;
const PLAYER_SPEED = 290;
const INTERACTION_DISTANCE = 96;
const DOORWAY = new Phaser.Geom.Rectangle(540, 454, 116, 112);
const PLATFORM = new Phaser.Geom.Rectangle(36, 344, 504, 360);
const CARRIAGE = new Phaser.Geom.Rectangle(656, 344, 1108, 360);
const DOOR_CENTER = new Phaser.Math.Vector2(DOORWAY.centerX, DOORWAY.centerY);

class PlaygroundScene extends Phaser.Scene {
  private readonly player = new Phaser.Math.Vector2(190, 540);
  private readonly sensor = new Phaser.Math.Vector2(1040, 474);
  private route: Point[] = [];
  private playerLabel!: Phaser.GameObjects.Text;
  private playerView!: Phaser.GameObjects.Arc;
  private sensorView!: Phaser.GameObjects.Rectangle;
  private prompt!: Phaser.GameObjects.Text;
  private status!: Phaser.GameObjects.Text;
  private timeHud!: Phaser.GameObjects.Text;
  private inspected = false;
  private world: WorldState = createWorldState();

  constructor() {
    super('PlaygroundScene');
  }

  create(): void {
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.drawLocation();

    this.playerView = this.add
      .circle(this.player.x, this.player.y, 18, 0x4aa3df)
      .setStrokeStyle(3, 0xe9f5ff);
    this.playerLabel = this.add
      .text(this.player.x, this.player.y - 38, 'Проводник', {
        color: '#e9f5ff',
        fontFamily: 'Arial, sans-serif',
        fontSize: '16px',
      })
      .setOrigin(0.5);

    this.sensorView = this.add
      .rectangle(this.sensor.x, this.sensor.y, 46, 58, 0x4d6b76)
      .setStrokeStyle(3, 0xa8c5d0);
    this.add
      .text(this.sensor.x, this.sensor.y + 45, 'Датчик', {
        color: '#dce8ed',
        fontFamily: 'Arial, sans-serif',
        fontSize: '15px',
      })
      .setOrigin(0.5);

    this.prompt = this.add
      .text(this.sensor.x, this.sensor.y - 64, '', {
        align: 'center',
        backgroundColor: '#18242bcc',
        color: '#ffffff',
        fontFamily: 'Arial, sans-serif',
        fontSize: '16px',
        padding: { x: 10, y: 6 },
      })
      .setOrigin(0.5)
      .setVisible(false);

    this.status = this.add
      .text(20, 20, 'Кликните по доступной точке, чтобы задать движение.', {
        backgroundColor: '#111820dd',
        color: '#ffffff',
        fontFamily: 'Arial, sans-serif',
        fontSize: '18px',
        padding: { x: 12, y: 8 },
        wordWrap: { width: 620 },
      })
      .setScrollFactor(0)
      .setDepth(10);

    this.timeHud = this.add
      .text(20, 162, '', {
        backgroundColor: '#111820bb',
        color: '#dce8ed',
        fontFamily: 'Arial, sans-serif',
        fontSize: '16px',
        padding: { x: 12, y: 8 },
      })
      .setScrollFactor(0)
      .setDepth(10);
    this.addTimeControls();
    this.refreshTimeHud();

    this.add
      .text(
        20,
        92,
        'Основное управление: клик по полу.\nПодойдите к датчику и кликните по нему или нажмите Space.',
        {
          backgroundColor: '#111820bb',
          color: '#dce8ed',
          fontFamily: 'Arial, sans-serif',
          fontSize: '16px',
          padding: { x: 12, y: 8 },
        },
      )
      .setScrollFactor(0)
      .setDepth(10);

    this.input.on(Phaser.Input.Events.POINTER_UP, (pointer: Phaser.Input.Pointer) => {
      const clickedSensor =
        Phaser.Math.Distance.Between(pointer.worldX, pointer.worldY, this.sensor.x, this.sensor.y) <
        44;
      if (clickedSensor && this.isNearSensor()) {
        this.inspectSensor();
        return;
      }

      const destination = new Phaser.Math.Vector2(pointer.worldX, pointer.worldY);
      if (!this.isAccessible(destination)) {
        this.showStatus('Эта точка за границей доступной геометрии.');
        return;
      }

      this.route = this.createRoute(destination);
      this.showStatus('Цель задана. Проводник идёт по доступному проходу.');
    });

    this.input.keyboard?.on('keydown-SPACE', () => {
      if (this.isNearSensor()) {
        this.inspectSensor();
      }
    });

    this.cameras.main.startFollow(this.playerView, true, 0.12, 0.12);
  }

  override update(_: number, delta: number): void {
    const scheduledChange = this.world.scheduledChange;
    this.world = advanceWorld(this.world, delta / 1000);
    if (scheduledChange === 'pending' && this.world.scheduledChange === 'completed') {
      this.showStatus('Плановое изменение: освещение вагона переведено в режим посадки.');
    }

    this.walkRoute((PLAYER_SPEED * delta) / 1000);
    this.playerView.setPosition(this.player.x, this.player.y);
    this.playerLabel.setPosition(this.player.x, this.player.y - 38);

    const nearby = this.isNearSensor();
    this.prompt
      .setText(this.inspected ? 'Датчик осмотрен' : 'Быстрый осмотр: клик или Space')
      .setVisible(nearby);
    this.refreshTimeHud();
  }

  private addTimeControls(): void {
    const controls: ReadonlyArray<{ readonly label: string; readonly speed: WorldSpeed }> = [
      { label: 'Пауза', speed: 0 },
      { label: 'Обычно', speed: 1 },
      { label: '×3', speed: 3 },
    ];

    controls.forEach((control, index) => {
      const button = this.add
        .text(20 + index * 108, 224, control.label, {
          backgroundColor: '#31414b',
          color: '#ffffff',
          fontFamily: 'Arial, sans-serif',
          fontSize: '16px',
          padding: { x: 10, y: 7 },
        })
        .setInteractive({ useHandCursor: true })
        .setScrollFactor(0)
        .setDepth(10);

      button.on(Phaser.Input.Events.POINTER_UP, () => {
        this.world = setWorldSpeed(this.world, control.speed);
        this.refreshTimeHud();
      });
    });
  }

  private refreshTimeHud(): void {
    const speedLabel = this.world.speed === 0 ? 'пауза' : `×${this.world.speed}`;
    const eventLabel =
      this.world.scheduledChange === 'pending' ? 'ожидается' : 'выполнено один раз';
    this.timeHud.setText(
      `Игровое время: ${this.world.elapsedSeconds.toFixed(1)} с | скорость: ${speedLabel}\nПлановое изменение: ${eventLabel}`,
    );
  }

  private drawLocation(): void {
    const graphics = this.add.graphics();
    graphics.fillStyle(0x52606b).fillRectShape(PLATFORM);
    graphics.fillStyle(0x68747c).fillRectShape(CARRIAGE);
    graphics.fillStyle(0x8f9ca3).fillRectShape(DOORWAY);
    graphics.lineStyle(6, 0x20282e).strokeRectShape(PLATFORM).strokeRectShape(CARRIAGE);
    graphics.lineStyle(3, 0xd9e2e5).strokeRectShape(DOORWAY);

    for (let x = 760; x < 1720; x += 160) {
      graphics.fillStyle(0x48545c).fillRect(x, 580, 96, 78);
      graphics.lineStyle(2, 0x9aa8ad).strokeRect(x, 580, 96, 78);
    }

    this.add
      .text(288, 375, 'ПЕРРОН', {
        color: '#f0f3f4',
        fontFamily: 'Arial, sans-serif',
        fontSize: '24px',
      })
      .setOrigin(0.5);
    this.add
      .text(1210, 375, 'ВАГОН · СЕРАЯ ГЕОМЕТРИЯ', {
        color: '#f0f3f4',
        fontFamily: 'Arial, sans-serif',
        fontSize: '24px',
      })
      .setOrigin(0.5);
    this.add
      .text(DOOR_CENTER.x, DOOR_CENTER.y - 78, 'ПРОХОД', {
        color: '#18242b',
        fontFamily: 'Arial, sans-serif',
        fontSize: '15px',
      })
      .setOrigin(0.5);
  }

  private createRoute(destination: Point): Point[] {
    const startsOnPlatform = PLATFORM.contains(this.player.x, this.player.y);
    const destinationOnPlatform = PLATFORM.contains(destination.x, destination.y);

    if (startsOnPlatform !== destinationOnPlatform) {
      return [DOOR_CENTER.clone(), destination];
    }

    return [destination];
  }

  private walkRoute(remainingDistance: number): void {
    while (remainingDistance > 0 && this.route.length > 0) {
      const target = this.route[0];
      if (target === undefined) {
        return;
      }
      const distance = Phaser.Math.Distance.Between(
        this.player.x,
        this.player.y,
        target.x,
        target.y,
      );

      if (distance <= remainingDistance) {
        this.player.copy(target);
        this.route.shift();
        remainingDistance -= distance;
      } else {
        const angle = Phaser.Math.Angle.Between(this.player.x, this.player.y, target.x, target.y);
        this.player.x += Math.cos(angle) * remainingDistance;
        this.player.y += Math.sin(angle) * remainingDistance;
        remainingDistance = 0;
      }
    }
  }

  private isAccessible(point: Point): boolean {
    return (
      PLATFORM.contains(point.x, point.y) ||
      CARRIAGE.contains(point.x, point.y) ||
      DOORWAY.contains(point.x, point.y)
    );
  }

  private isNearSensor(): boolean {
    return (
      Phaser.Math.Distance.Between(this.player.x, this.player.y, this.sensor.x, this.sensor.y) <=
      INTERACTION_DISTANCE
    );
  }

  private inspectSensor(): void {
    this.inspected = true;
    this.sensorView.setFillStyle(0x5f9e7a).setStrokeStyle(3, 0xd8ffe5);
    this.showStatus('Быстрый осмотр: датчик в норме. Результат отмечен зелёным.');
  }

  private showStatus(message: string): void {
    this.status.setText(message);
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: window.innerWidth,
  height: window.innerHeight,
  backgroundColor: '#263238',
  scale: { mode: Phaser.Scale.RESIZE },
  scene: [PlaygroundScene],
});
