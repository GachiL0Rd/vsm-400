import type {
  ActionOfferMessage,
  ClientCommand,
  CommandResultMessage,
  GameSnapshotMessage,
  PresentationEventMessage,
  PublicAttemptPhase,
  PublicGameState,
  ServerMessage,
} from '../../common';
import {
  achievementTitle,
  PRESENTATION_LOG_LIMIT,
  PRESENTATION_TOAST_LIMIT,
  phaseFeedText,
  phaseKey,
  rejectionCopy,
  SPEECH_TTL_MS,
  speakerLabel,
  TOAST_TTL_MS,
} from './presentation-copy';

export type ConnectionState =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'reconnecting'
  | 'error';

export interface PresentationObservation {
  readonly id: string;
  readonly atUs: number;
  readonly speaker: string;
  readonly text: string;
}

export interface PresentationFeedItem {
  readonly id: string;
  readonly atUs: number;
  readonly text: string;
}

export interface PresentationDialog {
  readonly kind: 'speech' | 'hint';
  readonly speaker: string | null;
  readonly text: string;
}

export interface PresentationToast {
  readonly id: string;
  readonly variant: 'notice' | 'achievement';
  readonly text: string;
  readonly paused: boolean;
  readonly remainingMs: number;
  readonly expiresAtMs: number;
}

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
  observations: readonly PresentationObservation[];
  events: readonly PresentationFeedItem[];
  dialog: PresentationDialog | null;
  toasts: readonly PresentationToast[];
}

type Listener = (state: Readonly<PresentationState>) => void;
type Timer = ReturnType<typeof setTimeout>;

interface QueuedToast {
  readonly id: string;
  readonly variant: PresentationToast['variant'];
  readonly text: string;
}

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
  observations: [],
  events: [],
  dialog: null,
  toasts: [],
});

export class PresentationStore {
  private state = initialState();
  private readonly listeners = new Set<Listener>();
  private readonly seen = new Set<string>();
  private readonly waiting: QueuedToast[] = [];
  private readonly toastTimers = new Map<string, Timer>();
  private dialogTimer: Timer | undefined;
  private toastSequence = 0;

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
    const hadOffer = this.state.currentOffer !== null;
    this.update({
      connection,
      ...(connection === 'connected' ? {} : { currentOffer: null }),
    });
    if (connection !== 'connected' && hadOffer) this.armSpeechHide();
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
        this.applyOffer(message);
        return;
      case 'command-result':
        this.applyCommandResult(message);
        return;
      case 'presentation-event':
        this.applyPresentationEvent(message);
        return;
      case 'session-state':
        this.update({ sessionState: message });
        return;
      case 'error':
        this.applyError(message);
        return;
    }
  }

  clearActionOffer(): void {
    if (this.state.currentOffer === null) return;
    this.update({ currentOffer: null });
    this.armSpeechHide();
  }

  pauseToast(id: string): void {
    const toast = this.state.toasts.find((item) => item.id === id);
    if (toast === undefined || toast.paused) return;
    this.clearToastTimer(id);
    const remainingMs = Math.max(0, toast.expiresAtMs - Date.now());
    this.replaceToast(id, { ...toast, paused: true, remainingMs });
  }

  resumeToast(id: string): void {
    const toast = this.state.toasts.find((item) => item.id === id);
    if (toast === undefined || !toast.paused) return;
    if (toast.remainingMs <= 0) {
      this.dismissToast(id);
      return;
    }
    const expiresAtMs = Date.now() + toast.remainingMs;
    this.replaceToast(id, { ...toast, paused: false, expiresAtMs });
    this.armToast(id, toast.remainingMs);
  }

  private applySnapshot(message: GameSnapshotMessage): void {
    const previousAttempt = this.state.publicState?.attemptId;
    const attemptChanged =
      previousAttempt !== undefined && previousAttempt !== message.state.attemptId;
    this.resetTransient();
    this.update({
      publicState: message.state,
      revision: message.state.revision,
      simTimeUs: message.state.timeUs,
      currentOffer: null,
      lastError: null,
      lastCommandResult: null,
      lastPresentationEvent: null,
      observations: [],
      events: [
        phaseItem(
          message.state.attemptId,
          message.state.revision,
          message.state.phase,
          message.state.timeUs,
        ),
      ],
      toasts: [],
      dialog: null,
      ...(attemptChanged ? { sessionState: null } : {}),
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
      this.requestResync();
      return;
    }

    const entities = message.changes.entities
      ? mergeEntityDelta(
          previous.entities,
          message.changes.entities.removeIds,
          message.changes.entities.upsert,
        )
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
    const hadOffer = this.state.currentOffer !== null;
    const events =
      phaseKey(previous.phase) === phaseKey(next.phase)
        ? this.state.events
        : prependLimited(
            this.state.events,
            phaseItem(next.attemptId, next.revision, next.phase, next.timeUs),
            PRESENTATION_LOG_LIMIT,
          );
    this.update({
      publicState: next,
      revision: next.revision,
      simTimeUs: next.timeUs,
      currentOffer: null,
      events,
    });
    if (hadOffer) this.armSpeechHide();
  }

  private applyOffer(message: ActionOfferMessage): void {
    if (message.revision !== this.state.revision) return;
    this.update({ currentOffer: message });
    this.clearDialogTimer();
  }

  private applyError(message: Extract<ServerMessage, { type: 'error' }>): void {
    this.update({ connection: 'error', lastError: message });
    this.prependEvent({
      id: `error:${message.requestId ?? message.code}:${message.message}`,
      atUs: this.state.simTimeUs ?? 0,
      text: message.message,
    });
    this.enqueueToast({ id: this.nextToastId(), variant: 'notice', text: message.message });
  }

  private applyCommandResult(message: CommandResultMessage): void {
    this.update({ lastCommandResult: message });
    if (message.status !== 'rejected') return;
    const text = rejectionCopy(message.code, message.message);
    if (text === null) {
      const hadOffer = this.state.currentOffer !== null;
      this.update({ currentOffer: null });
      if (hadOffer) this.armSpeechHide();
      this.requestResync();
      return;
    }
    this.prependEvent({
      id: `reject:${message.requestId}`,
      atUs: this.state.simTimeUs ?? 0,
      text,
    });
    this.enqueueToast({ id: this.nextToastId(), variant: 'notice', text });
  }

  private applyPresentationEvent(message: PresentationEventMessage): void {
    const attemptId = this.state.publicState?.attemptId;
    if (attemptId === undefined || message.attemptId !== attemptId) {
      this.options.log?.('Presentation event ignored.', message.event);
      return;
    }
    if (!this.remember(`${message.attemptId}:${message.sequence}`)) return;
    this.update({ lastPresentationEvent: message });
    switch (message.event.kind) {
      case 'speech':
        this.applySpeech(message);
        return;
      case 'notification':
        this.applyNotification(message);
        return;
      case 'achievement-unlocked':
        this.applyAchievement(message);
        return;
      case 'hint':
        this.applyHint(message);
        return;
      case 'effect':
        this.options.log?.('Presentation effect ignored.', message.event);
        return;
    }
  }

  private applySpeech(message: PresentationEventMessage): void {
    const event = message.event;
    if (event.kind !== 'speech') return;
    if (!event.visible) {
      if (this.state.dialog?.kind === 'speech') this.setDialog(null, false);
      return;
    }
    const speaker = speakerLabel(event.entityId, this.state.publicState?.entities ?? []);
    this.update({
      observations: prependLimited(
        this.state.observations,
        {
          id: `${message.attemptId}:${message.sequence}`,
          atUs: message.at,
          speaker,
          text: event.text,
        },
        PRESENTATION_LOG_LIMIT,
      ),
    });
    this.setDialog({ kind: 'speech', speaker, text: event.text }, true);
  }

  private applyNotification(message: PresentationEventMessage): void {
    const event = message.event;
    if (event.kind !== 'notification') return;
    this.prependEvent({
      id: `${message.attemptId}:${message.sequence}`,
      atUs: message.at,
      text: event.text,
    });
    this.enqueueToast({ id: this.nextToastId(), variant: 'notice', text: event.text });
  }

  private applyAchievement(message: PresentationEventMessage): void {
    const event = message.event;
    if (event.kind !== 'achievement-unlocked') return;
    const title = achievementTitle(event.achievementId);
    this.prependEvent({
      id: `${message.attemptId}:${message.sequence}`,
      atUs: message.at,
      text: title,
    });
    this.enqueueToast({ id: this.nextToastId(), variant: 'achievement', text: title });
  }

  private applyHint(message: PresentationEventMessage): void {
    const event = message.event;
    if (event.kind !== 'hint') return;
    const text = event.text ?? 'Подсказка';
    if (event.presentation === 'message') {
      this.setDialog({ kind: 'hint', speaker: null, text }, false);
      return;
    }
    if (event.presentation === 'toast') {
      this.enqueueToast({ id: this.nextToastId(), variant: 'notice', text });
      return;
    }
    this.options.log?.('Presentation highlight ignored.', event);
  }

  private setDialog(dialog: PresentationDialog | null, autoHide: boolean): void {
    this.update({ dialog });
    if (autoHide) this.armSpeechHide();
    else this.clearDialogTimer();
  }

  private armSpeechHide(): void {
    this.clearDialogTimer();
    if (this.state.dialog?.kind !== 'speech' || this.state.currentOffer !== null) return;
    this.dialogTimer = setTimeout(() => {
      this.dialogTimer = undefined;
      if (this.state.dialog?.kind === 'speech' && this.state.currentOffer === null) {
        this.update({ dialog: null });
      }
    }, SPEECH_TTL_MS);
  }

  private clearDialogTimer(): void {
    if (this.dialogTimer === undefined) return;
    clearTimeout(this.dialogTimer);
    this.dialogTimer = undefined;
  }

  private prependEvent(entry: PresentationFeedItem): void {
    this.update({
      events: prependLimited(this.state.events, entry, PRESENTATION_LOG_LIMIT),
    });
  }

  private enqueueToast(toast: QueuedToast): void {
    if (this.state.toasts.length >= PRESENTATION_TOAST_LIMIT) {
      this.waiting.push(toast);
      if (this.waiting.length > PRESENTATION_LOG_LIMIT) {
        this.waiting.splice(0, this.waiting.length - PRESENTATION_LOG_LIMIT);
      }
      return;
    }
    this.showToast(toast);
  }

  private showToast(toast: QueuedToast): void {
    const visible: PresentationToast = {
      ...toast,
      paused: false,
      remainingMs: TOAST_TTL_MS,
      expiresAtMs: Date.now() + TOAST_TTL_MS,
    };
    this.update({ toasts: this.state.toasts.concat(visible) });
    this.armToast(visible.id, TOAST_TTL_MS);
  }

  private armToast(id: string, delayMs: number): void {
    this.clearToastTimer(id);
    if (delayMs <= 0) {
      this.dismissToast(id);
      return;
    }
    const timer = setTimeout(() => {
      this.toastTimers.delete(id);
      this.dismissToast(id);
    }, delayMs);
    this.toastTimers.set(id, timer);
  }

  private dismissToast(id: string): void {
    if (!this.state.toasts.some((toast) => toast.id === id)) return;
    this.clearToastTimer(id);
    this.update({ toasts: this.state.toasts.filter((toast) => toast.id !== id) });
    const next = this.waiting.shift();
    if (next !== undefined) this.showToast(next);
  }

  private replaceToast(id: string, next: PresentationToast): void {
    this.update({
      toasts: this.state.toasts.map((toast) => (toast.id === id ? next : toast)),
    });
  }

  private clearToastTimer(id: string): void {
    const timer = this.toastTimers.get(id);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.toastTimers.delete(id);
  }

  private remember(key: string): boolean {
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    if (this.seen.size <= 500) return true;
    const oldest = this.seen.values().next().value;
    if (oldest !== undefined) this.seen.delete(oldest);
    return true;
  }

  private nextToastId(): string {
    this.toastSequence += 1;
    return `toast-${this.toastSequence}`;
  }

  private resetTransient(): void {
    this.clearDialogTimer();
    for (const id of Array.from(this.toastTimers.keys())) this.clearToastTimer(id);
    this.seen.clear();
    this.waiting.splice(0, this.waiting.length);
  }

  private requestResync(): void {
    this.options.send({
      protocolVersion: 1,
      type: 'resync',
      requestId: this.options.nextRequestId(),
      knownRevision: this.state.revision ?? undefined,
    });
  }

  private update(change: Partial<PresentationState>): void {
    this.state = { ...this.state, ...change };
    for (const listener of this.listeners) listener(this.state);
  }
}

function phaseItem(
  attemptId: string,
  revision: number,
  phase: PublicAttemptPhase,
  atUs: number,
): PresentationFeedItem {
  return {
    id: `phase:${attemptId}:${revision}:${phaseKey(phase)}`,
    atUs,
    text: phaseFeedText(phase),
  };
}

function prependLimited<T>(items: readonly T[], item: T, limit: number): T[] {
  const next = [item].concat(items);
  return next.length > limit ? next.slice(0, limit) : next;
}

function mergeEntityDelta(
  previous: PublicGameState['entities'],
  removeIds: readonly string[],
  upsert: PublicGameState['entities'],
): PublicGameState['entities'] {
  const replaced = new Set([...removeIds, ...upsert.map((entity) => entity.id)]);
  return [...previous.filter((entity) => !replaced.has(entity.id)), ...upsert];
}
