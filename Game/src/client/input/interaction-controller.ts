import {
  type ClientCommand,
  GAME_PROTOCOL_VERSION,
  type InvokeActionCommand,
  type PublicGameState,
  type PublicTargetRef,
} from '../../common';
import type { ClientLogLevel } from '../diagnostics/client-log';
import type { PresentationStore } from '../presentation/presentation-store';

type NavigationLog = (level: ClientLogLevel, event: string, data?: Record<string, unknown>) => void;

export class InteractionController {
  private requestSequence = 0;
  private destinationCellId: string | null = null;
  private pendingMove: { requestId: string; targetCellId: string } | null = null;
  private awaitingArrivalCellId: string | null = null;

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

    const publicState = state.publicState;
    const player = publicState?.entities.find((entity) => entity.kind === 'player');
    if (this.awaitingArrivalCellId !== null) {
      if (player?.position.kind !== 'cell' || player.position.cellId !== this.awaitingArrivalCellId)
        return;
      this.log?.('info', 'step-arrived', {
        cellId: this.awaitingArrivalCellId,
        revision: state.revision,
      });
      this.awaitingArrivalCellId = null;
    }
    if (this.destinationCellId === null || this.pendingMove !== null || publicState === null)
      return;
    if (player?.position.kind !== 'cell') return;
    if (player.position.cellId === this.destinationCellId) {
      this.log?.('info', 'route-completed', {
        cellId: this.destinationCellId,
        revision: state.revision,
      });
      this.destinationCellId = null;
      return;
    }

    const revision = this.activeRevision();
    if (revision === null) return;
    const nextCellId = nextStep(publicState, player.position.cellId, this.destinationCellId);
    if (nextCellId === null) {
      this.log?.('warn', 'route-unavailable', {
        fromCellId: player.position.cellId,
        destinationCellId: this.destinationCellId,
        revision,
      });
      this.destinationCellId = null;
      return;
    }
    const requestId = this.nextRequestId();
    this.pendingMove = { requestId, targetCellId: nextCellId };
    this.log?.('info', 'step-sent', {
      requestId,
      fromCellId: player.position.cellId,
      targetCellId: nextCellId,
      destinationCellId: this.destinationCellId,
      revision,
    });
    this.send({
      protocolVersion: GAME_PROTOCOL_VERSION,
      type: 'move-to',
      requestId,
      knownRevision: revision,
      targetCellId: nextCellId,
    });
  }

  private observeMoveResult(): void {
    const result = this.store.snapshot.lastCommandResult;
    if (this.pendingMove === null || result?.requestId !== this.pendingMove.requestId) return;
    if (result.status === 'accepted') {
      this.awaitingArrivalCellId = this.pendingMove.targetCellId;
      this.log?.('info', 'step-accepted', {
        requestId: result.requestId,
        targetCellId: this.pendingMove.targetCellId,
        revision: result.revision,
      });
    } else {
      this.log?.('warn', 'step-rejected', {
        requestId: result.requestId,
        targetCellId: this.pendingMove.targetCellId,
        revision: result.revision,
        code: result.code,
        message: result.message,
      });
      this.destinationCellId = null;
    }
    this.pendingMove = null;
  }

  private clearNavigation(): void {
    if (
      this.destinationCellId !== null ||
      this.pendingMove !== null ||
      this.awaitingArrivalCellId !== null
    )
      this.log?.('warn', 'route-cancelled-on-disconnect', {
        destinationCellId: this.destinationCellId,
        pendingRequestId: this.pendingMove?.requestId,
        awaitingArrivalCellId: this.awaitingArrivalCellId,
      });
    this.destinationCellId = null;
    this.pendingMove = null;
    this.awaitingArrivalCellId = null;
  }

  private activeRevision(): number | null {
    const state = this.store.snapshot;
    if (
      state.sessionState?.state === 'finishing' ||
      state.sessionState?.state === 'finished' ||
      state.sessionState?.state === 'aborted'
    )
      return null;
    return state.revision;
  }

  private nextRequestId(): string {
    this.requestSequence += 1;
    return `client-${this.requestSequence}`;
  }
}

/** The server accepts one directed edge per move-to command. */
function nextStep(
  state: PublicGameState,
  fromCellId: string,
  destinationCellId: string,
): string | null {
  const availableCells = new Set(state.world.cells.map((cell) => cell.id));
  if (!availableCells.has(fromCellId) || !availableCells.has(destinationCellId)) return null;
  const neighbors = adjacencyFor(state, availableCells);
  const previous = new Map<string, string | null>([[fromCellId, null]]);
  const queue = [fromCellId];
  for (const current of queue) {
    for (const neighbor of neighbors.get(current) ?? []) {
      if (previous.has(neighbor)) continue;
      previous.set(neighbor, current);
      if (neighbor === destinationCellId) return firstStep(previous, fromCellId, neighbor);
      queue.push(neighbor);
    }
  }
  return null;
}

function adjacencyFor(
  state: PublicGameState,
  availableCells: ReadonlySet<string>,
): Map<string, string[]> {
  const neighbors = new Map<string, string[]>();
  for (const edge of state.world.edges) {
    if (!availableCells.has(edge.fromCellId) || !availableCells.has(edge.toCellId)) continue;
    const destinations = neighbors.get(edge.fromCellId) ?? [];
    destinations.push(edge.toCellId);
    neighbors.set(edge.fromCellId, destinations);
  }
  return neighbors;
}

function firstStep(
  previous: ReadonlyMap<string, string | null>,
  fromCellId: string,
  toCellId: string,
): string | null {
  let step = toCellId;
  while (previous.get(step) !== fromCellId) {
    const parent = previous.get(step);
    if (parent === undefined || parent === null) return null;
    step = parent;
  }
  return step;
}
