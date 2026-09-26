import Phaser from 'phaser';
import { type CommandInput, type ConnectionStatus, GameConnection } from './connection';
import { CollisionManager } from './managers/CollisionManager';
import { DialogueManager } from './managers/DialogueManager';
import { HudManager } from './managers/HudManager';
import { InputManager } from './managers/InputManager';
import { InteractionManager } from './managers/InteractionManager';
import { NpcManager } from './managers/NpcManager';
import { PauseManager } from './managers/PauseManager';
import { PlayerManager } from './managers/PlayerManager';
import { PoiManager } from './managers/PoiManager';
import { SoundManager } from './managers/SoundManager';
import { VfxManager } from './managers/VfxManager';
import { ViewportManager } from './managers/ViewportManager';
import { WorldManager } from './managers/WorldManager';
import type { ObservableSnapshot } from './protocol';
import type { ClientState } from './state';

/** The single composition root for the browser game's presentation. */
export class GameScene extends Phaser.Scene {
  private world!: WorldManager;
  private collision!: CollisionManager;
  private player!: PlayerManager;
  private npcs!: NpcManager;
  private poi!: PoiManager;
  private inputManager!: InputManager;
  private viewport!: ViewportManager;
  private interaction!: InteractionManager;
  private hud!: HudManager;
  private dialogue!: DialogueManager;
  private soundManager!: SoundManager;
  private vfx!: VfxManager;
  private pauseManager!: PauseManager;
  private connection!: GameConnection;
  private snapshot: ObservableSnapshot | null = null;
  private snapshotSerial = 0;
  private status: ConnectionStatus = 'connecting';
  private ready = false;
  private readonly onBeforeUnload = (): void => this.connection?.stop();

  constructor(
    private readonly uiRoot: HTMLElement,
    private readonly socketUrl: string,
  ) {
    super('GameScene');
  }

  create(): void {
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this);
    this.events.once(Phaser.Scenes.Events.DESTROY, this.shutdown, this);
    this.world = new WorldManager(this);
    this.world.create();
    this.collision = new CollisionManager(
      () => this.player.getTile(),
      () => this.npcs.getTiles(),
    );
    this.player = new PlayerManager(
      this,
      this.collision,
      (zone) => this.connection.sendCommand({ kind: 'move-zone', zoneId: zone }),
      (message) => this.say(message),
      () => this.viewport?.resize(),
    );
    this.viewport = new ViewportManager(this, this.player.body);
    this.viewport.centerOnPlayer(this.player.body);
    this.hud = new HudManager(
      this.uiRoot,
      (command) => this.send(command),
      () => this.connection.connect(),
      (selection) => this.interaction.select(selection),
      (id) => this.player.goToAnchor(id),
      (id) => this.player.isNear(id),
    );
    this.interaction = new InteractionManager(
      this,
      this.hud.detailsRoot,
      (id) => this.npcs.getBody(id),
      (id) => this.poi.getVisualTile(id),
      (id) => this.player.isNear(id),
      (id) => this.player.goToAnchor(id),
      (command) => this.send(command),
    );
    this.dialogue = new DialogueManager(this.hud.dialogueRoot, (command) => this.send(command));
    this.soundManager = new SoundManager();
    this.hud.addSoundControl(this.soundManager.control);
    this.pauseManager = new PauseManager(this.hud.devControls, (speed) =>
      this.send({ kind: 'dev-control', speed }),
    );
    this.inputManager = new InputManager(
      this,
      () => this.status === 'ready' && this.snapshot?.phase !== 'finished',
      (tile) => this.player.moveToTile(tile),
      (selection) => this.interaction.select(selection),
    );
    this.npcs = new NpcManager(this, this.collision, this.inputManager);
    this.poi = new PoiManager(this, this.inputManager);
    this.vfx = new VfxManager(this, this.player.body, (duration) => this.player.reactFor(duration));
    this.connection = new GameConnection(this.socketUrl, (state, status) =>
      this.onConnectionChange(state, status),
    );
    this.ready = true;
    window.addEventListener('beforeunload', this.onBeforeUnload);
    this.connection.connect();
  }

  override update(_time: number, delta: number): void {
    if (!this.ready) return;
    this.player.update(delta);
    this.npcs.update(delta);
    this.interaction.update();
  }

  private onConnectionChange(state: ClientState, status: ConnectionStatus): void {
    if (!this.ready) return;
    this.status = status;
    const current = state.snapshot;
    if (current === null) {
      this.player.setStatus(status);
      this.hud.render(state, status);
      this.pauseManager.sync(null, status);
      return;
    }
    const previous = this.snapshot;
    const full =
      state.snapshotSerial !== this.snapshotSerial ||
      previous?.sessionId !== current.sessionId ||
      current.revision < (previous?.revision ?? 0);
    this.snapshot = current;
    this.snapshotSerial = state.snapshotSerial;
    if (full) {
      this.player.reset(current.playerZone);
      this.npcs.reset();
      this.poi.reset();
      this.interaction.reset();
      this.dialogue.reset();
      this.vfx.reset();
      this.hud.reset();
      this.viewport.centerOnPlayer(this.player.body);
    }
    this.player.sync(current, status, state.notice);
    this.npcs.sync(current.npcs);
    this.poi.sync(current.poi);
    this.interaction.sync(current);
    this.dialogue.sync(current.dialogue);
    this.hud.render(state, status);
    this.pauseManager.sync(current, status);
    this.soundManager.sync(previous, current, full);
    this.vfx.sync(previous, current, full);
  }

  private send(command: CommandInput): void {
    if (this.connection.sendCommand(command) === null)
      this.say('Действие сейчас недоступно: нет подтверждённой связи или состояния.');
  }

  private say(message: string): void {
    this.hud.say(message);
    if (message.includes('подошёл')) this.interaction.refresh();
  }

  private shutdown(): void {
    if (!this.ready) return;
    this.ready = false;
    this.events.off(Phaser.Scenes.Events.DESTROY, this.shutdown, this);
    window.removeEventListener('beforeunload', this.onBeforeUnload);
    this.connection.stop();
    this.inputManager.destroy();
    this.vfx.destroy();
    this.poi.destroy();
    this.npcs.destroy();
    this.interaction.destroy();
    this.dialogue.destroy();
    this.pauseManager.destroy();
    this.soundManager.destroy();
    this.hud.destroy();
    this.viewport.destroy();
    this.player.destroy();
    this.world.destroy();
    this.snapshot = null;
    this.snapshotSerial = 0;
    this.status = 'connecting';
  }
}
