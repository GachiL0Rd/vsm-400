import type {
  ActionOfferMessage,
  ClientCommand,
  CommandResultMessage,
  GameSnapshotMessage,
  PresentationEventMessage,
  PublicGameState,
  ServerMessage,
} from '../../common';

export type ConnectionState =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'reconnecting'
  | 'error';

export interface PresentationState {
  connection: ConnectionState;
  publicState: PublicGameState | null;
  revision: number | null;
  simTimeUs: number | null;
  currentOffer: ActionOfferMessage | null;
  sessionState: Extract<ServerMessage, { type: 'session-state' }> | null;
  lastCommandResult: CommandResultMessage | null;
  lastPresentationEvent: PresentationEventMessage | null;
  lastError: Extract<ServerMessage, { type: 'error' }> | null;
}

type Listener = (state: Readonly<PresentationState>) => void;

export interface PresentationStoreOptions {
  send(command: ClientCommand): void;
  nextRequestId(): string;
  log?(message: string, detail?: unknown): void;
}

const initialState = (): PresentationState => ({
  connection: 'disconnected',
  publicState: null,
  revision: null,
  simTimeUs: null,
  currentOffer: null,
  sessionState: null,
  lastCommandResult: null,
  lastPresentationEvent: null,
  lastError: null,
});

export class PresentationStore {
  private state = initialState();
  private readonly listeners = new Set<Listener>();

  constructor(private readonly options: PresentationStoreOptions) {}

  get snapshot(): Readonly<PresentationState> {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  setConnection(connection: ConnectionState): void {
    this.update({ connection });
  }

  apply(message: ServerMessage): void {
    switch (message.type) {
      case 'session-ready':
        this.applySnapshot(message.snapshot);
        return;
      case 'snapshot':
        this.applySnapshot(message);
        return;
      case 'delta':
        this.applyDelta(message);
        return;
      case 'action-offer':
        if (message.revision === this.state.revision) this.update({ currentOffer: message });
        return;
      case 'command-result':
        this.update({ lastCommandResult: message });
        return;
      case 'presentation-event':
        this.options.log?.('Presentation event received.', message.event);
        this.update({ lastPresentationEvent: message });
        return;
      case 'session-state':
        this.update({ sessionState: message });
        return;
      case 'error':
        this.update({ connection: 'error', lastError: message });
    }
  }

  private applySnapshot(message: GameSnapshotMessage): void {
    this.update({
      publicState: message.state,
      revision: message.state.revision,
      simTimeUs: message.state.timeUs,
      currentOffer: null,
    });
  }

  private applyDelta(message: Extract<ServerMessage, { type: 'delta' }>): void {
    const previous = this.state.publicState;
    if (
      previous === null ||
      previous.attemptId !== message.attemptId ||
      previous.revision !== message.baseRevision
    ) {
      this.options.log?.('Presentation revision mismatch; requesting resync.', message);
      this.options.send({
        protocolVersion: 1,
        type: 'resync',
        requestId: this.options.nextRequestId(),
        knownRevision: this.state.revision ?? undefined,
      });
      return;
    }

    const entities = message.changes.entities
      ? [
          ...previous.entities.filter(
            (entity) => !message.changes.entities?.removeIds.includes(entity.id),
          ),
          ...message.changes.entities.upsert,
        ]
      : previous.entities;
    const next: PublicGameState = {
      ...previous,
      timeUs: message.changes.timeUs ?? previous.timeUs,
      clock: message.changes.clock ?? previous.clock,
      phase: message.changes.phase ?? previous.phase,
      termination:
        message.changes.termination === undefined
          ? previous.termination
          : message.changes.termination,
      activeRegionIds: message.changes.activeRegionIds ?? previous.activeRegionIds,
      world: message.changes.world ?? previous.world,
      entities,
      revision: message.revision,
    };
    this.update({
      publicState: next,
      revision: next.revision,
      simTimeUs: next.timeUs,
      currentOffer: null,
    });
  }

  private update(change: Partial<PresentationState>): void {
    this.state = { ...this.state, ...change };
    for (const listener of this.listeners) listener(this.state);
  }
}
