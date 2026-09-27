import {
  type ClientCommand,
  GAME_PROTOCOL_VERSION,
  type InvokeActionCommand,
  type PublicGameState,
  type PublicTargetRef,
} from '../../common';
import type { ClientLogLevel } from '../diagnostics/client-log';
import type { PresentationState, PresentationStore } from '../presentation/presentation-store';

type NavigationLog = (level: ClientLogLevel, event: string, data?: Record<string, unknown>) => void;

interface PlayerCell {
  readonly cellId: string;
}

/** Sends one move-to for the clicked cell. The server routes the path. */
export class InteractionController {
  private requestSequence = 0;
  private destinationCellId: string | null = null;
  private sentDestination: string | null = null;
  private sentFromCellId: string | null = null;
  private awaitingDeparture = false;
  private pendingMove: { requestId: string; targetCellId: string } | null = null;

  constructor(
    private readonly store: PresentationStore,
    private readonly send: (command: ClientCommand) => void,
    private readonly log?: NavigationLog,
  ) {
    this.store.subscribe(() => this.advanceMovement());
  }

  moveTo(targetCellId: string): void {
    if (this.store.snapshot.publicState?.mode.kind === 'replay') {
      this.log?.('warn', 'route-ignored-in-replay', { targetCellId });
      return;
    }
    this.log?.('info', 'route-requested', {
      targetCellId,
      revision: this.store.snapshot.revision,
      playerPosition: this.store.snapshot.publicState?.entities.find(
        (entity) => entity.kind === 'player',
      )?.position,
    });
    this.destinationCellId = targetCellId;
    this.sentDestination = null;
    this.advanceMovement();
  }

  queryActions(target: PublicTargetRef): void {
    this.store.clearActionOffer();
    if (this.store.snapshot.publicState?.mode.kind === 'replay') return;
    const revision = this.activeRevision();
    if (revision === null) return;
    this.log?.('info', 'actions-requested', { target, revision });
    this.send({
      protocolVersion: GAME_PROTOCOL_VERSION,
      type: 'query-actions',
      requestId: this.nextRequestId(),
      knownRevision: revision,
      target,
    });
  }

  invokeAction(actionHandle: string, input?: InvokeActionCommand['input']): void {
    if (this.store.snapshot.publicState?.mode.kind === 'replay') return;
    const revision = this.activeRevision();
    const offer = this.store.snapshot.currentOffer;
    if (revision === null || offer === null || offer.revision !== revision) return;
    if (!offer.actions.some((action) => action.handle === actionHandle)) return;
    this.log?.('info', 'action-invoked', { actionHandle, revision, hasInput: input !== undefined });
    this.send({
      protocolVersion: GAME_PROTOCOL_VERSION,
      type: 'invoke-action',
      requestId: this.nextRequestId(),
      knownRevision: revision,
      actionHandle,
      ...(input === undefined ? {} : { input }),
    });
    this.store.clearActionOffer();
  }

  setTimeScale(scale: 1 | 2 | 4): void {
    const revision = this.activeRevision();
    if (revision === null) return;
    this.log?.('info', 'time-scale-requested', { scale, revision });
    this.send({
      protocolVersion: GAME_PROTOCOL_VERSION,
      type: 'set-time-scale',
      requestId: this.nextRequestId(),
      knownRevision: revision,
      scale,
    });
  }

  private advanceMovement(): void {
    const state = this.store.snapshot;
    if (state.connection !== 'connected') {
      this.clearNavigation();
      return;
    }
    this.observeMoveResult();
    this.sendMove(state);
  }

  private sendMove(state: PresentationState): void {
    const destinationCellId = this.destinationCellId;
    const publicState = state.publicState;
    const player = standingPlayer(publicState);
    if (destinationCellId === null || this.pendingMove !== null || publicState === null) return;
    if (player === null) return;
    if (this.stillAwaitingDeparture(player)) return;
    if (player.cellId === destinationCellId) {
      this.log?.('info', 'route-completed', {
        cellId: destinationCellId,
        revision: state.revision,
      });
      this.destinationCellId = null;
      this.sentDestination = null;
      this.awaitingDeparture = false;
      return;
    }
    if (this.sentDestination === destinationCellId) return;
    const revision = this.activeRevision();
    if (revision === null) return;
    if (!publicState.world.cells.some((cell) => cell.id === destinationCellId)) {
      this.log?.('warn', 'route-unavailable', {
        fromCellId: player.cellId,
        destinationCellId,
        revision,
      });
      this.destinationCellId = null;
      return;
    }
    this.emitMove(destinationCellId, player.cellId, revision);
  }

  private stillAwaitingDeparture(player: PlayerCell): boolean {
    if (!this.awaitingDeparture) return false;
    if (player.cellId !== this.sentFromCellId) {
      this.awaitingDeparture = false;
      return false;
    }
    return true;
  }

  private emitMove(destinationCellId: string, fromCellId: string, revision: number): void {
    const requestId = this.nextRequestId();
    this.pendingMove = { requestId, targetCellId: destinationCellId };
    this.sentDestination = destinationCellId;
    this.sentFromCellId = fromCellId;
    this.awaitingDeparture = true;
    this.log?.('info', 'move-sent', {
      requestId,
      fromCellId,
      targetCellId: destinationCellId,
      revision,
    });
    this.send({
      protocolVersion: GAME_PROTOCOL_VERSION,
      type: 'move-to',
      requestId,
      knownRevision: revision,
      targetCellId: destinationCellId,
    });
  }

  private observeMoveResult(): void {
    const result = this.store.snapshot.lastCommandResult;
    if (this.pendingMove === null || result?.requestId !== this.pendingMove.requestId) return;
    const targetCellId = this.pendingMove.targetCellId;
    this.pendingMove = null;
    if (result.status === 'accepted') {
      this.log?.('info', 'move-accepted', {
        requestId: result.requestId,
        targetCellId,
        revision: result.revision,
      });
      return;
    }
    this.log?.('warn', 'move-rejected', {
      requestId: result.requestId,
      targetCellId,
      revision: result.revision,
      code: result.code,
      message: result.message,
    });
    if (this.destinationCellId === targetCellId) this.destinationCellId = null;
    if (this.sentDestination === targetCellId) this.sentDestination = null;
    this.awaitingDeparture = false;
  }

  private clearNavigation(): void {
    if (this.destinationCellId !== null || this.pendingMove !== null || this.awaitingDeparture) {
      this.log?.('warn', 'route-cancelled-on-disconnect', {
        destinationCellId: this.destinationCellId,
        pendingRequestId: this.pendingMove?.requestId,
      });
    }
    this.destinationCellId = null;
    this.sentDestination = null;
    this.sentFromCellId = null;
    this.awaitingDeparture = false;
    this.pendingMove = null;
  }

  private activeRevision(): number | null {
    const state = this.store.snapshot;
    if (
      state.sessionState?.state === 'finishing' ||
      state.sessionState?.state === 'finished' ||
      state.sessionState?.state === 'aborted'
    ) {
      return null;
    }
    return state.revision;
  }

  private nextRequestId(): string {
    this.requestSequence += 1;
    return `client-${this.requestSequence}`;
  }
}

function standingPlayer(state: PublicGameState | null): PlayerCell | null {
  const player = state?.entities.find((entity) => entity.kind === 'player');
  if (player?.position.kind !== 'cell') return null;
  return { cellId: player.position.cellId };
}
