import Phaser from 'phaser';
import type { PublicGameState } from '../common';
import type { InteractionController } from './input/interaction-controller';
import { GameHud } from './presentation/game-hud';
import type { PresentationStore } from './presentation/presentation-store';
import { preloadCharacterArt } from './rendering/character-art';
import { TILE_SIZE } from './rendering/tile-layout';
import { preloadTrain2Map } from './rendering/train2-map';
import { WorldRenderer } from './rendering/world-renderer';

export interface GameSceneDependencies {
  store: PresentationStore;
  interactions: InteractionController;
  log?(source: 'input' | 'render', event: string, data: Record<string, unknown>): void;
  downloadLog?(): void;
}

const MAP_ROWS = 16;
const MOBILE_MIN_ZOOM = 0.55;
const SHORT_LANDSCAPE_HEIGHT = 450;

/** Browser view of server state. Clicks are sent as intents, never applied locally. */
export class GameScene extends Phaser.Scene {
  private worldRenderer: WorldRenderer | null = null;
  private hud: GameHud | null = null;
  private followTarget: Phaser.GameObjects.Rectangle | null = null;
  private followStarted = false;
  private unsubscribe: (() => void) | null = null;
  private lastState: PublicGameState | null = null;
  private lastWorld: PublicGameState['world'] | null = null;
  private lastLoggedPlayerFrame: string | null = null;
  private receivedAtMs = 0;

  constructor(private readonly dependencies: GameSceneDependencies) {
    super('GameScene');
  }

  preload(): void {
    preloadCharacterArt(this);
    preloadTrain2Map(this);
  }

  create(): void {
    this.dependencies.log?.('render', 'scene-created', {
      viewportWidth: this.scale.width,
      viewportHeight: this.scale.height,
    });
    this.followTarget = this.add.rectangle(0, 0, 1, 1, 0xffffff, 0).setVisible(false);
    this.worldRenderer = new WorldRenderer(this);
    const parent = this.game.canvas.parentElement;
    if (parent !== null) {
      this.hud = new GameHud(
        parent,
        this.dependencies.store,
        this.dependencies.interactions,
        this.dependencies.downloadLog,
      );
    }
    this.input.mouse?.disableContextMenu();
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.handlePointer(pointer);
    });
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      this.handleHover(pointer);
    });
    this.scale.on('resize', this.fitCamera, this);
    this.unsubscribe = this.dependencies.store.subscribe((state) => {
      const publicState = state.publicState;
      const worldChanged = publicState?.world !== this.lastWorld;
      if (publicState !== this.lastState) {
        this.lastState = publicState;
        this.receivedAtMs = performance.now();
      }
      this.redraw();
      if (!worldChanged) return;
      this.lastWorld = publicState?.world ?? null;
      this.fitCamera();
    });
    this.fitCamera();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.dependencies.log?.('render', 'scene-shutdown', {});
      this.unsubscribe?.();
      this.unsubscribe = null;
      this.scale.off('resize', this.fitCamera, this);
      this.hud?.destroy();
      this.hud = null;
      this.worldRenderer?.clear();
      this.worldRenderer = null;
      this.followTarget = null;
      this.followStarted = false;
    });
  }

  override update(): void {
    this.redraw();
  }

  private visualTimeUs(state: PublicGameState): number {
    const presentation = this.dependencies.store.snapshot;
    if (
      presentation.connection !== 'connected' ||
      state.clock.paused ||
      state.termination !== null ||
      state.phase.kind === 'finished'
    ) {
      return state.timeUs;
    }
    const elapsedMs = Math.min(2_000, Math.max(0, performance.now() - this.receivedAtMs));
    return state.timeUs + elapsedMs * 1_000 * state.clock.timeScale;
  }

  private redraw(): void {
    if (this.worldRenderer === null) return;
    const state = this.dependencies.store.snapshot.publicState;
    if (state === null) {
      this.worldRenderer.clear();
      this.lastLoggedPlayerFrame = null;
      return;
    }
    const visualTimeUs = this.visualTimeUs(state);
    this.worldRenderer.render(state, visualTimeUs);
    const player = this.worldRenderer.playerPoint(state, visualTimeUs);
    if (player !== null) this.followTarget?.setPosition(player.x, player.y);
    this.logPlayerFrame(state, visualTimeUs, player);
    this.hud?.setVisualTime(visualTimeUs);
  }

  private logPlayerFrame(
    state: PublicGameState,
    visualTimeUs: number,
    point: { x: number; y: number } | null,
  ): void {
    const position = state.entities.find((entity) => entity.kind === 'player')?.position;
    const frame =
      position?.kind === 'moving'
        ? `${position.edgeId}:${Math.floor(position.progress * 4)}`
        : position?.kind === 'cell'
          ? `cell:${position.cellId}`
          : `other:${position?.kind ?? 'missing'}`;
    if (frame === this.lastLoggedPlayerFrame) return;
    this.lastLoggedPlayerFrame = frame;
    this.dependencies.log?.('render', 'player-frame', {
      revision: state.revision,
      position,
      visualTimeUs: Math.round(visualTimeUs),
      worldPoint: point === null ? null : { x: Math.round(point.x), y: Math.round(point.y) },
      camera: {
        scrollX: Math.round(this.cameras.main.scrollX),
        scrollY: Math.round(this.cameras.main.scrollY),
        zoom: this.cameras.main.zoom,
      },
    });
  }

  private fitCamera(): void {
    const width = this.scale.width;
    const height = this.scale.height;
    // The DOM HUD overlays the canvas (PSD layout); only narrow portrait keeps reserved bands.
    const phoneLandscape = height <= 500 && width > height;
    const narrow = width <= 760 && !phoneLandscape;
    const left = 0;
    const top = narrow ? 166 : 0;
    const bottom = narrow ? 82 : 0;
    const viewportWidth = Math.max(1, width - left);
    const viewportHeight = Math.max(220, height - top - bottom);
    const camera = this.cameras.main;
    const frame = this.worldRenderer?.worldFrame() ?? {
      x: 0,
      y: 0,
      width: TILE_SIZE * MAP_ROWS,
      height: TILE_SIZE * MAP_ROWS,
    };
    camera.setBounds(frame.x, frame.y, frame.width, frame.height);
    camera.setViewport(left, top, viewportWidth, viewportHeight);
    camera.setZoom(viewZoom(viewportHeight, compactViewport(width, height, narrow)));
    this.placeFollow(this.focusPoint(), true);
  }

  private placeFollow(point: { x: number; y: number }, snap: boolean): void {
    const target = this.followTarget;
    if (target === null) return;
    target.setPosition(point.x, point.y);
    const camera = this.cameras.main;
    if (!this.followStarted) {
      camera.startFollow(target, true, 0.1, 0.1);
      this.followStarted = true;
      return;
    }
    if (snap) camera.centerOn(point.x, point.y);
  }

  private focusPoint(): { x: number; y: number } {
    const state = this.dependencies.store.snapshot.publicState;
    const player =
      state === null || this.worldRenderer === null
        ? null
        : this.worldRenderer.playerPoint(state, this.visualTimeUs(state));
    if (player !== null) return player;
    const frame = this.worldRenderer?.worldFrame();
    if (frame === undefined) return { x: 0, y: 0 };
    return { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 };
  }

  private handlePointer(pointer: Phaser.Input.Pointer): void {
    this.handleHover(pointer);
    const state = this.dependencies.store.snapshot.publicState;
    if (state === null || this.worldRenderer === null) {
      this.logPointer(pointer, 'click-ignored-no-state');
      return;
    }
    const { worldX, worldY } = pointer;
    const cell = this.worldRenderer.cellAt(state, worldX, worldY);
    this.worldRenderer.setHoveredCell(cell?.id ?? null);
    const target = this.worldRenderer.targetAt(state, worldX, worldY, this.visualTimeUs(state));
    if (target !== null && !pointer.rightButtonDown() && !pointer.event.shiftKey) {
      this.logPointer(pointer, 'click-target', { target, revision: state.revision });
      this.dependencies.interactions.queryActions(target);
      return;
    }
    if (cell === null) {
      this.logPointer(pointer, 'click-outside-world', { revision: state.revision });
      return;
    }
    if (pointer.rightButtonDown() || pointer.event.shiftKey) {
      this.logPointer(pointer, 'click-cell-actions', { cellId: cell.id, revision: state.revision });
      this.dependencies.interactions.queryActions({ kind: 'cell', cellId: cell.id });
      return;
    }
    this.logPointer(pointer, 'click-move', { cellId: cell.id, revision: state.revision });
    this.dependencies.interactions.moveTo(cell.id);
  }

  private logPointer(
    pointer: Phaser.Input.Pointer,
    event: string,
    data: Record<string, unknown> = {},
  ): void {
    this.dependencies.log?.('input', event, {
      screenX: Math.round(pointer.x),
      screenY: Math.round(pointer.y),
      worldX: Math.round(pointer.worldX),
      worldY: Math.round(pointer.worldY),
      button: pointer.button,
      shift: pointer.event.shiftKey,
      ...data,
    });
  }

  private handleHover(pointer: Phaser.Input.Pointer): void {
    const state = this.dependencies.store.snapshot.publicState;
    if (state === null || this.worldRenderer === null) return;
    const cell = this.worldRenderer.cellAt(state, pointer.worldX, pointer.worldY);
    this.worldRenderer.setHoveredCell(cell?.id ?? null);
    const target = this.worldRenderer.targetAt(
      state,
      pointer.worldX,
      pointer.worldY,
      this.visualTimeUs(state),
    );
    if (target?.kind === 'object') {
      const object = state.world.objects.find((candidate) => candidate.id === target.objectId);
      this.hud?.setTarget(`Объект: ${objectName(object?.kind ?? target.objectId)}`);
      return;
    }
    if (target?.kind === 'entity') {
      const entity = state.entities.find((candidate) => candidate.id === target.entityId);
      this.hud?.setTarget(entity?.kind === 'player' ? 'Проводник' : 'Пассажир');
      return;
    }
    this.hud?.setTarget(cell === null ? null : 'Кликните, чтобы переместиться сюда');
  }
}

function compactViewport(width: number, height: number, narrow: boolean): boolean {
  return narrow || (width > height && height <= SHORT_LANDSCAPE_HEIGHT);
}

function viewZoom(viewportHeight: number, compact: boolean): number {
  const fit = viewportHeight / (MAP_ROWS * TILE_SIZE);
  if (!Number.isFinite(fit) || fit <= 0) return compact ? MOBILE_MIN_ZOOM : 1;
  return compact ? Math.max(MOBILE_MIN_ZOOM, fit) : fit;
}

function objectName(kind: string): string {
  const names: Record<string, string> = {
    'acceptance-journal': 'Журнал приёмки',
    extinguisher: 'Огнетушитель',
    'climate-control': 'Климат-контроль',
    'emergency-brake': 'Стоп-кран',
    'driver-comms': 'Связь с машинистом',
    'service-point': 'Точка обслуживания',
  };
  return names[kind] ?? kind;
}
