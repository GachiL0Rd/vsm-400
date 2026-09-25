import Phaser from 'phaser';
import { createDebrief } from './assessment';
import { getDialogueSet } from './content/dialogues';
import { FIRE_EXTINGUISHER_DEFINITION, PRESSURE_SENSOR_DEFINITION } from './content/objects';
import { DEMO_PASSENGER } from './content/passengers';
import { applyDialogueOption, selectDialogueVariant, type DialogueOption } from './dialogue';
import {
  applyFireExtinguisher,
  createEquipmentState,
  createFireExtinguisherInspection,
  prepareFireExtinguisher,
  takeFireExtinguisher,
  type EquipmentAction,
  type EquipmentState,
  type ExtinguisherInspectionActionId,
} from './equipment';
import {
  advanceFireIncident,
  attemptToExtinguishFire,
  createFireIncidentState,
  FIRE_BECOMES_SEVERE_AT_SECONDS,
  FIRE_STARTS_AT_SECONDS,
  SIMULATION_CAN_END_AT_SECONDS,
  type FireIncidentState,
} from './incident';
import {
  advancePassenger,
  createPassengerState,
  type PassengerActivity,
  type PassengerState,
} from './passenger';
import type { InspectionActionDefinition, InspectionViewModel } from './inspection';
import {
  createPressureInspection,
  createPressureSystemState,
  inspectPressureIndicator,
  quickInspectPressureSystem,
  type PressureSensorActionId,
  type PressureSystemState,
} from './systems';
import {
  advanceWorld,
  createWorldState,
  setWorldSpeed,
  type WorldSpeed,
  type WorldState,
} from './world';

type Point = Phaser.Math.Vector2;
type ModalKind = 'sensor' | 'extinguisher' | 'passenger' | 'debrief';

const WORLD_WIDTH = 1800;
const WORLD_HEIGHT = 760;
const PLAYER_SPEED = 290;
const NPC_SPEED = 135;
const INTERACTION_DISTANCE = 96;
const DOORWAY = new Phaser.Geom.Rectangle(540, 454, 116, 112);
const PLATFORM = new Phaser.Geom.Rectangle(36, 344, 504, 360);
const CARRIAGE = new Phaser.Geom.Rectangle(656, 344, 1108, 360);
const DOOR_CENTER = new Phaser.Math.Vector2(DOORWAY.centerX, DOORWAY.centerY);
const PLAYER_START = new Phaser.Math.Vector2(190, 540);
const NPC_PLATFORM_POSITION = new Phaser.Math.Vector2(430, 540);
const NPC_SEAT_POSITION = new Phaser.Math.Vector2(892, 612);
const SENSOR_POSITION = new Phaser.Math.Vector2(1040, 474);
const EXTINGUISHER_POSITION = new Phaser.Math.Vector2(1440, 474);
const FIRE_POSITION = new Phaser.Math.Vector2(1260, 614);

class PlaygroundScene extends Phaser.Scene {
  private readonly player = PLAYER_START.clone();
  private readonly npcPosition = NPC_PLATFORM_POSITION.clone();
  private readonly sensor = SENSOR_POSITION.clone();
  private readonly extinguisher = EXTINGUISHER_POSITION.clone();
  private route: Point[] = [];

  private playerLabel!: Phaser.GameObjects.Text;
  private playerView!: Phaser.GameObjects.Arc;
  private npcLabel!: Phaser.GameObjects.Text;
  private npcView!: Phaser.GameObjects.Arc;
  private sensorView!: Phaser.GameObjects.Rectangle;
  private extinguisherView!: Phaser.GameObjects.Rectangle;
  private fireView!: Phaser.GameObjects.Arc;
  private fireLabel!: Phaser.GameObjects.Text;
  private prompt!: Phaser.GameObjects.Text;
  private status!: Phaser.GameObjects.Text;
  private timeHud!: Phaser.GameObjects.Text;
  private itemHud!: Phaser.GameObjects.Text;
  private endButton!: Phaser.GameObjects.Text;

  private modalElements: Phaser.GameObjects.GameObject[] = [];
  private modal: ModalKind | undefined;
  private simulationEnded = false;

  private equipment: EquipmentState = createEquipmentState();
  private world: WorldState = createWorldState();
  private passenger: PassengerState = createPassengerState(DEMO_PASSENGER);
  private pressure: PressureSystemState = createPressureSystemState();
  private fire: FireIncidentState = createFireIncidentState();

  constructor() {
    super('PlaygroundScene');
  }

  create(): void {
    this.resetState();
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.drawLocation();
    this.createWorldObjects();
    this.createHud();
    this.bindInput();
    this.cameras.main.startFollow(this.playerView, true, 0.12, 0.12);
  }

  override update(_: number, delta: number): void {
    if (!this.simulationEnded) {
      this.advanceSimulation(delta);
    }

    this.walkRoute((PLAYER_SPEED * delta) / 1000);
    this.updateNpcPosition(delta);
    this.refreshViews();
    this.refreshPrompt();
    this.refreshHud();
  }

  private resetState(): void {
    this.player.copy(PLAYER_START);
    this.npcPosition.copy(NPC_PLATFORM_POSITION);
    this.route = [];
    this.modalElements = [];
    this.modal = undefined;
    this.simulationEnded = false;
    this.equipment = createEquipmentState();
    this.world = createWorldState();
    this.passenger = createPassengerState(DEMO_PASSENGER);
    this.pressure = createPressureSystemState();
    this.fire = createFireIncidentState();
  }

  private createWorldObjects(): void {
    this.playerView = this.add
      .circle(this.player.x, this.player.y, 18, 0x4aa3df)
      .setStrokeStyle(3, 0xe9f5ff);
    this.playerLabel = this.add
      .text(this.player.x, this.player.y - 38, 'Проводник', textStyle('#e9f5ff', '16px'))
      .setOrigin(0.5);

    this.npcView = this.add
      .circle(this.npcPosition.x, this.npcPosition.y, 17, 0xd2a84a)
      .setStrokeStyle(3, 0xfff1bf);
    this.npcLabel = this.add
      .text(
        this.npcPosition.x,
        this.npcPosition.y - 36,
        DEMO_PASSENGER.displayName,
        textStyle('#fff1bf', '15px'),
      )
      .setOrigin(0.5);

    this.sensorView = this.add
      .rectangle(this.sensor.x, this.sensor.y, 46, 58, 0x4d6b76)
      .setStrokeStyle(3, 0xa8c5d0);
    this.add
      .text(
        this.sensor.x,
        this.sensor.y + 45,
        PRESSURE_SENSOR_DEFINITION.worldLabel,
        textStyle('#dce8ed', '15px'),
      )
      .setOrigin(0.5);

    this.extinguisherView = this.add
      .rectangle(this.extinguisher.x, this.extinguisher.y, 34, 66, 0xa53737)
      .setStrokeStyle(3, 0xffd7c2);
    this.add
      .text(
        this.extinguisher.x,
        this.extinguisher.y + 50,
        FIRE_EXTINGUISHER_DEFINITION.worldLabel,
        textStyle('#dce8ed', '15px'),
      )
      .setOrigin(0.5);

    this.fireView = this.add.circle(FIRE_POSITION.x, FIRE_POSITION.y, 30, 0xf26a2e).setVisible(false);
    this.fireLabel = this.add
      .text(FIRE_POSITION.x, FIRE_POSITION.y - 48, 'ОЧАГ', textStyle('#ffd7c2', '15px'))
      .setOrigin(0.5)
      .setVisible(false);
  }

  private createHud(): void {
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
        wordWrap: { width: 700 },
      })
      .setScrollFactor(0)
      .setDepth(10);

    this.add
      .text(
        20,
        92,
        'Клик по полу — движение. Рядом с объектом клик открывает действие.\nSpace — быстрый осмотр датчика. Мир продолжает идти во время осмотра и диалога.',
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

    this.itemHud = this.add
      .text(20, 278, '', {
        backgroundColor: '#111820bb',
        color: '#dce8ed',
        fontFamily: 'Arial, sans-serif',
        fontSize: '16px',
        padding: { x: 12, y: 8 },
      })
      .setInteractive({ useHandCursor: true })
      .setScrollFactor(0)
      .setDepth(10);
    this.itemHud.on(Phaser.Input.Events.POINTER_UP, () => {
      if (this.equipment.heldItem === 'fire-extinguisher') {
        this.openModal('extinguisher');
      } else {
        this.showStatus('В руке нет предмета для подробного осмотра.');
      }
    });

    this.endButton = this.add
      .text(20, 330, 'Показать итог', {
        backgroundColor: '#38515f',
        color: '#ffffff',
        fontFamily: 'Arial, sans-serif',
        fontSize: '16px',
        padding: { x: 12, y: 8 },
      })
      .setInteractive({ useHandCursor: true })
      .setScrollFactor(0)
      .setDepth(10)
      .setVisible(false);
    this.endButton.on(Phaser.Input.Events.POINTER_UP, () => this.finishSimulation());

    this.refreshHud();
  }

  private bindInput(): void {
    this.input.on(Phaser.Input.Events.POINTER_UP, (pointer: Phaser.Input.Pointer) => {
      if (this.modal !== undefined || this.simulationEnded) {
        return;
      }

      if (this.wasClickedNear(pointer, this.sensor, 44) && this.isNear(this.sensor)) {
        this.openModal('sensor');
        return;
      }

      if (this.wasClickedNear(pointer, this.extinguisher, 44) && this.isNear(this.extinguisher)) {
        this.openModal('extinguisher');
        return;
      }

      if (this.wasClickedNear(pointer, this.npcPosition, 46) && this.isNear(this.npcPosition)) {
        this.openModal('passenger');
        return;
      }

      if (
        this.fire.status !== 'dormant' &&
        this.fire.status !== 'resolved' &&
        this.wasClickedNear(pointer, FIRE_POSITION, 54) &&
        this.isNear(FIRE_POSITION)
      ) {
        this.handleFireInteraction();
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
      if (this.modal === undefined && this.isNear(this.sensor)) {
        this.inspectSensor();
      }
    });
  }

  private advanceSimulation(delta: number): void {
    const previousScheduledChange = this.world.scheduledChange;
    const previousPassengerActivity = this.passenger.activity;
    const previousFireStatus = this.fire.status;

    this.world = advanceWorld(this.world, delta / 1000);
    this.passenger = advancePassenger(DEMO_PASSENGER, this.passenger, this.world.elapsedSeconds);
    this.fire = advanceFireIncident(this.fire, this.world.elapsedSeconds);

    if (
      previousScheduledChange === 'pending' &&
      this.world.scheduledChange === 'completed'
    ) {
      this.showStatus('Плановое изменение: освещение вагона переведено в режим посадки.');
    }

    if (previousPassengerActivity !== this.passenger.activity) {
      this.showStatus(this.passengerActivityMessage(this.passenger.activity));
    }

    if (previousFireStatus !== this.fire.status) {
      if (this.fire.status === 'active') {
        this.showStatus('Инцидент: в вагоне возник условный очаг пожара. Мир продолжает идти.');
      } else if (this.fire.status === 'severe') {
        this.showStatus('Пожар ухудшился из-за отсутствия своевременной реакции.');
      }
    }
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
        if (!this.simulationEnded) {
          this.world = setWorldSpeed(this.world, control.speed);
        }
      });
    });
  }

  private refreshHud(): void {
    const speedLabel = this.world.speed === 0 ? 'пауза' : `×${this.world.speed}`;
    const eventLabel =
      this.world.scheduledChange === 'pending' ? 'ожидается' : 'выполнено один раз';
    this.timeHud.setText(
      `Игровое время: ${this.world.elapsedSeconds.toFixed(1)} с | скорость: ${speedLabel}\n` +
        `Плановое изменение: ${eventLabel} | NPC: ${passengerActivityLabel(this.passenger.activity)}\n` +
        `Пожар: ${fireStatusLabel(this.fire.status)}`,
    );

    if (this.equipment.heldItem === 'none') {
      this.itemHud.setText('В руке: ничего');
    } else {
      const readiness =
        this.equipment.extinguisher.readiness === 'prepared' ? 'подготовлен' : 'не подготовлен';
      this.itemHud.setText(
        `В руке: огнетушитель (${readiness})\nКликните здесь для подробного осмотра.`,
      );
    }

    const canEnd =
      this.world.elapsedSeconds >= SIMULATION_CAN_END_AT_SECONDS ||
      (this.fire.status === 'resolved' && this.passenger.documentDecision !== 'pending');
    this.endButton.setVisible(canEnd && !this.simulationEnded);
  }

  private refreshViews(): void {
    this.playerView.setPosition(this.player.x, this.player.y);
    this.playerLabel.setPosition(this.player.x, this.player.y - 38);
    this.npcView.setPosition(this.npcPosition.x, this.npcPosition.y);
    this.npcLabel.setPosition(this.npcPosition.x, this.npcPosition.y - 36);

    const fireVisible = this.fire.status === 'active' || this.fire.status === 'severe';
    this.fireView.setVisible(fireVisible);
    this.fireLabel.setVisible(fireVisible);
    if (this.fire.status === 'severe') {
      this.fireView.setRadius(42).setFillStyle(0xef3f22);
      this.fireLabel.setText('СИЛЬНЫЙ ОЧАГ');
    } else if (this.fire.status === 'active') {
      this.fireView.setRadius(30).setFillStyle(0xf26a2e);
      this.fireLabel.setText('ОЧАГ');
    }

    this.extinguisherView.setVisible(this.equipment.extinguisher.position === 'stored');
  }

  private updateNpcPosition(delta: number): void {
    const target = this.passengerTarget();
    movePointToward(this.npcPosition, target, (NPC_SPEED * delta) / 1000);
  }

  private passengerTarget(): Point {
    switch (this.passenger.activity) {
      case 'waiting-on-platform':
        return NPC_PLATFORM_POSITION;
      case 'boarding':
        return DOOR_CENTER;
      case 'seated':
        return NPC_SEAT_POSITION;
    }
  }

  private passengerActivityMessage(activity: PassengerActivity): string {
    switch (activity) {
      case 'waiting-on-platform':
        return 'Пассажир ожидает на перроне.';
      case 'boarding':
        return 'Пассажир самостоятельно начал посадку.';
      case 'seated':
        return 'Пассажир самостоятельно направился к своему месту.';
    }
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
      .text(288, 375, 'ПЕРРОН', textStyle('#f0f3f4', '24px'))
      .setOrigin(0.5);
    this.add
      .text(1210, 375, 'ВАГОН · СЕРАЯ ГЕОМЕТРИЯ', textStyle('#f0f3f4', '24px'))
      .setOrigin(0.5);
    this.add
      .text(DOOR_CENTER.x, DOOR_CENTER.y - 78, 'ПРОХОД', textStyle('#18242b', '15px'))
      .setOrigin(0.5);
    this.add
      .text(FIRE_POSITION.x, 684, 'зона условного инцидента', textStyle('#c8d2d6', '13px'))
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

  private isNear(point: Point): boolean {
    return (
      Phaser.Math.Distance.Between(this.player.x, this.player.y, point.x, point.y) <=
      INTERACTION_DISTANCE
    );
  }

  private wasClickedNear(pointer: Phaser.Input.Pointer, point: Point, radius: number): boolean {
    return Phaser.Math.Distance.Between(pointer.worldX, pointer.worldY, point.x, point.y) < radius;
  }

  private inspectSensor(): void {
    const action = quickInspectPressureSystem(this.pressure);
    this.pressure = action.state;
    if (action.accepted) {
      this.sensorView.setFillStyle(0x5f9e7a).setStrokeStyle(3, 0xd8ffe5);
    }
    this.showStatus(action.message);
  }

  private refreshPrompt(): void {
    if (this.modal !== undefined || this.simulationEnded) {
      this.prompt.setVisible(false);
      return;
    }

    if (
      this.fire.status !== 'dormant' &&
      this.fire.status !== 'resolved' &&
      this.isNear(FIRE_POSITION)
    ) {
      this.prompt
        .setPosition(FIRE_POSITION.x, FIRE_POSITION.y - 78)
        .setText('Очаг: клик — применить предмет в руке')
        .setVisible(true);
      return;
    }

    if (this.isNear(this.npcPosition)) {
      this.prompt
        .setPosition(this.npcPosition.x, this.npcPosition.y - 66)
        .setText(`${DEMO_PASSENGER.displayName}: клик — разговор и документы`)
        .setVisible(true);
      return;
    }

    if (this.isNear(this.sensor)) {
      this.prompt
        .setPosition(this.sensor.x, this.sensor.y - 64)
        .setText(
          this.pressure.quickInspected
            ? `${PRESSURE_SENSOR_DEFINITION.worldLabel} осмотрен: клик — подробности`
            : `Space — быстро, клик — подробно`,
        )
        .setVisible(true);
      return;
    }

    if (this.isNear(this.extinguisher) && this.equipment.extinguisher.position === 'stored') {
      this.prompt
        .setPosition(this.extinguisher.x, this.extinguisher.y - 72)
        .setText(FIRE_EXTINGUISHER_DEFINITION.interactionPrompt)
        .setVisible(true);
      return;
    }

    this.prompt.setVisible(false);
  }

  private openModal(kind: Exclude<ModalKind, 'debrief'>): void {
    this.route = [];
    this.modal = kind;
    this.renderModal();
  }

  private renderModal(): void {
    this.clearModal();

    switch (this.modal) {
      case 'sensor':
        this.renderSensorInspection();
        break;
      case 'extinguisher':
        this.renderExtinguisherInspection();
        break;
      case 'passenger':
        this.renderPassengerDialog();
        break;
      case 'debrief':
        this.renderDebrief();
        break;
      case undefined:
        break;
    }
  }

  private renderSensorInspection(): void {
    const view = createPressureInspection(PRESSURE_SENSOR_DEFINITION, this.pressure);
    this.renderInspectionPanel(view, (action) => this.handlePressureInspectionAction(action.id));
  }

  private renderExtinguisherInspection(): void {
    const view = createFireExtinguisherInspection(FIRE_EXTINGUISHER_DEFINITION, this.equipment);
    this.renderInspectionPanel(view, (action) => this.handleExtinguisherInspectionAction(action.id));
  }

  private renderInspectionPanel<ActionId extends string>(
    view: InspectionViewModel<ActionId>,
    onAction: (action: InspectionActionDefinition<ActionId>) => void,
  ): void {
    const panelHeight = 280 + view.properties.length * 34 + view.actions.length * 52;
    const top = Math.max(80, 720 - panelHeight);
    this.addModalRectangle(18, top, 620, panelHeight, 0x17232bf2);
    this.addModalText(38, top + 20, view.title, { color: '#ffffff', fontSize: '20px' });

    let y = top + 62;
    if (view.description !== undefined) {
      this.addModalText(38, y, view.description, { color: '#dce8ed', fontSize: '15px' });
      y += 40;
    }

    for (const property of view.properties) {
      const color =
        property.tone === 'good'
          ? '#d8ffe5'
          : property.tone === 'warning'
            ? '#ffd7c2'
            : '#dce8ed';
      this.addModalText(38, y, `${property.label}: ${property.value}`, { color });
      y += 34;
    }

    y += 8;
    for (const action of view.actions) {
      if (action.enabled) {
        this.addModalButton(38, y, action.label, () => onAction(action));
      } else {
        this.addModalText(38, y + 5, `Недоступно: ${action.label}`, {
          color: '#80919a',
          fontSize: '15px',
        });
        if (action.disabledReason !== undefined) {
          this.addModalText(330, y + 5, action.disabledReason, {
            color: '#80919a',
            fontSize: '14px',
          });
        }
      }
      y += 52;
    }

    if (view.footer !== undefined) {
      this.addModalText(38, y, view.footer, { color: '#a8c5d0', fontSize: '14px' });
      y += 38;
    }

    this.addCloseModalButton(38, y);
  }

  private handlePressureInspectionAction(actionId: PressureSensorActionId): void {
    switch (actionId) {
      case 'check-pressure-indicator': {
        const action = inspectPressureIndicator(this.pressure);
        this.pressure = action.state;
        if (action.accepted) {
          this.sensorView.setFillStyle(0x5f9e7a).setStrokeStyle(3, 0xd8ffe5);
        }
        this.showStatus(action.message);
        this.renderModal();
        break;
      }
    }
  }

  private handleExtinguisherInspectionAction(actionId: ExtinguisherInspectionActionId): void {
    switch (actionId) {
      case 'take-fire-extinguisher':
        this.applyEquipmentAction(takeFireExtinguisher(this.equipment));
        break;
      case 'prepare-fire-extinguisher':
        this.applyEquipmentAction(prepareFireExtinguisher(this.equipment));
        break;
      case 'test-fire-extinguisher-handle':
        this.applyEquipmentAction(applyFireExtinguisher(this.equipment));
        break;
    }
  }

  private renderPassengerDialog(): void {
    const dialogue = getDialogueSet(DEMO_PASSENGER.dialogueSetId);
    const variant = selectDialogueVariant(dialogue, this.passenger);

    this.addModalRectangle(18, 300, 920, 426, 0x17232bf2);
    this.addModalText(38, 320, `${DEMO_PASSENGER.displayName} · диалог и проверка документов`, {
      color: '#ffffff',
      fontSize: '20px',
    });
    this.addModalText(38, 356, variant.passengerLines.join('\n'), { color: '#fff1bf' });
    this.addModalText(
      620,
      356,
      `Внимательность: ${this.passenger.attention}\nНастроение: ${passengerMoodLabel(this.passenger.mood)}`,
      { color: '#a8c5d0', fontSize: '14px' },
    );

    this.addModalRectangle(38, 410, 370, 150, 0x283740);
    this.addModalText(54, 424, 'УДОСТОВЕРЕНИЕ ЛИЧНОСТИ', { color: '#9ed3ea', fontSize: '14px' });
    this.addModalText(
      54,
      454,
      `${DEMO_PASSENGER.document.fullName}\n№ ${DEMO_PASSENGER.document.documentNumber}\nДата рождения: ${DEMO_PASSENGER.document.birthDate}`,
      { color: '#ffffff', fontSize: '16px' },
    );

    this.addModalRectangle(430, 410, 470, 150, 0x283740);
    this.addModalText(446, 424, 'БИЛЕТ', { color: '#9ed3ea', fontSize: '14px' });
    this.addModalText(
      446,
      454,
      `${DEMO_PASSENGER.ticket.fullName}\n${DEMO_PASSENGER.ticket.train} · вагон ${DEMO_PASSENGER.ticket.carriage}\nМесто ${DEMO_PASSENGER.ticket.seat}`,
      { color: '#ffffff', fontSize: '16px' },
    );

    let optionX = 38;
    for (const option of variant.options) {
      this.addModalButton(optionX, 588, option.label, () => this.applyPassengerDialogueOption(option));
      optionX += 150;
    }

    if (variant.options.length === 0) {
      const quality =
        this.passenger.decisionQuality === 'correct'
          ? 'решение корректно'
          : this.passenger.decisionQuality === 'incorrect'
            ? 'решение ошибочно'
            : 'решение не оценено';
      this.addModalText(38, 592, `Зафиксировано: ${quality}.`, {
        color: this.passenger.decisionQuality === 'correct' ? '#d8ffe5' : '#ffd7c2',
      });
    }

    this.addCloseModalButton(38, 660);
  }

  private renderDebrief(): void {
    const debrief = createDebrief(this.passenger, this.fire);
    this.addModalRectangle(110, 92, 1040, 560, 0x111820f5);
    this.addModalText(140, 120, 'Итог технического полигона', {
      color: '#ffffff',
      fontSize: '26px',
    });
    this.addModalText(140, 174, 'ОЦЕНКА ДЕЙСТВИЙ', { color: '#9ed3ea', fontSize: '17px' });
    this.addModalText(140, 210, debrief.potentialAssessment.map((line) => `• ${line}`).join('\n'), {
      color: '#ffffff',
      fontSize: '17px',
    });
    this.addModalText(140, 326, 'ФАКТИЧЕСКИЙ ИСХОД', { color: '#9ed3ea', fontSize: '17px' });
    this.addModalText(140, 362, debrief.factualOutcome.map((line) => `• ${line}`).join('\n'), {
      color: '#ffffff',
      fontSize: '17px',
    });
    this.addModalText(
      140,
      480,
      `Неудачных попыток тушения: ${this.fire.failedAttempts}\n` +
        `Пожар стартует на ${FIRE_STARTS_AT_SECONDS} с и ухудшается на ${FIRE_BECOMES_SEVERE_AT_SECONDS} с.`,
      { color: '#a8c5d0', fontSize: '15px' },
    );
    this.addModalButton(140, 558, 'Повторить полигон', () => this.scene.restart());
  }

  private applyPassengerDialogueOption(option: DialogueOption): void {
    const action = applyDialogueOption(DEMO_PASSENGER, this.passenger, option);
    this.passenger = action.state;
    this.showStatus(action.message);
    this.renderModal();
  }

  private applyEquipmentAction(action: EquipmentAction): void {
    this.equipment = action.state;
    this.showStatus(action.message);
    this.refreshViews();
    this.refreshHud();
    this.renderModal();
  }

  private handleFireInteraction(): void {
    const equipmentAction = applyFireExtinguisher(this.equipment);
    const fireAction = attemptToExtinguishFire(this.fire, this.equipment);
    this.fire = fireAction.state;

    if (!equipmentAction.accepted) {
      this.showStatus(`${equipmentAction.message} ${fireAction.message}`);
      return;
    }

    this.showStatus(fireAction.message);
    this.refreshViews();
    this.refreshHud();
  }

  private finishSimulation(): void {
    if (this.simulationEnded) {
      return;
    }

    this.route = [];
    this.world = setWorldSpeed(this.world, 0);
    this.simulationEnded = true;
    this.modal = 'debrief';
    this.renderModal();
  }

  private addCloseModalButton(x: number, y: number): void {
    this.addModalButton(x, y, 'Закрыть', () => {
      this.modal = undefined;
      this.clearModal();
      this.refreshPrompt();
    });
  }

  private clearModal(): void {
    this.modalElements.forEach((element) => element.destroy());
    this.modalElements = [];
  }

  private addModalRectangle(
    x: number,
    y: number,
    width: number,
    height: number,
    color: number,
  ): void {
    this.modalElements.push(
      this.add.rectangle(x, y, width, height, color).setOrigin(0).setScrollFactor(0).setDepth(20),
    );
  }

  private addModalText(
    x: number,
    y: number,
    value: string,
    style: Phaser.Types.GameObjects.Text.TextStyle,
  ): void {
    this.modalElements.push(
      this.add
        .text(x, y, value, {
          fontFamily: 'Arial, sans-serif',
          fontSize: '17px',
          ...style,
        })
        .setScrollFactor(0)
        .setDepth(21),
    );
  }

  private addModalButton(x: number, y: number, label: string, handler: () => void): void {
    const button = this.add
      .text(x, y, label, {
        backgroundColor: '#31414b',
        color: '#ffffff',
        fontFamily: 'Arial, sans-serif',
        fontSize: '16px',
        padding: { x: 10, y: 7 },
      })
      .setInteractive({ useHandCursor: true })
      .setScrollFactor(0)
      .setDepth(21);
    button.on(Phaser.Input.Events.POINTER_UP, handler);
    this.modalElements.push(button);
  }

  private showStatus(message: string): void {
    this.status.setText(message);
  }
}

function movePointToward(current: Point, target: Point, distance: number): void {
  const remaining = Phaser.Math.Distance.Between(current.x, current.y, target.x, target.y);
  if (remaining === 0) {
    return;
  }
  if (remaining <= distance) {
    current.copy(target);
    return;
  }

  const angle = Phaser.Math.Angle.Between(current.x, current.y, target.x, target.y);
  current.x += Math.cos(angle) * distance;
  current.y += Math.sin(angle) * distance;
}

function passengerActivityLabel(activity: PassengerActivity): string {
  switch (activity) {
    case 'waiting-on-platform':
      return 'ожидает';
    case 'boarding':
      return 'идёт в вагон';
    case 'seated':
      return 'на месте';
  }
}


function passengerMoodLabel(mood: PassengerState['mood']): string {
  switch (mood) {
    case 'calm':
      return 'спокойное';
    case 'neutral':
      return 'нейтральное';
    case 'annoyed':
      return 'раздражённое';
  }
}

function fireStatusLabel(status: FireIncidentState['status']): string {
  switch (status) {
    case 'dormant':
      return 'нет';
    case 'active':
      return 'активен';
    case 'severe':
      return 'ухудшился';
    case 'resolved':
      return 'ликвидирован';
  }
}

function textStyle(color: string, fontSize: string): Phaser.Types.GameObjects.Text.TextStyle {
  return {
    color,
    fontFamily: 'Arial, sans-serif',
    fontSize,
  };
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
