import { performance } from 'node:perf_hooks';
import {
  GAME_PROTOCOL_VERSION,
  type GameDeltaMessage,
  type PublicClockView,
  type ServerMessage,
} from '../common/game-wire.ts';
import type {
  InvokeResult,
  PublicGameProjection,
  RecordedGameplayCommand,
} from '../projection/public-game-session.ts';
import type { AssessmentResult } from '../simulation/assessment.ts';
import type { GameAttemptSnapshot } from '../simulation/game-attempt.ts';
import { SimulationClock } from '../simulation/simulation-clock.ts';
import type { ResolvedGameContent } from './content-registry.ts';
import { createSilentServerLogger, type ServerLogger } from './logger.ts';
import { parseReplayInputs, type RecordedReplayInput } from './replay-input.ts';
import type { ResumeTokenRegistry } from './resume-token-registry.ts';
import type {
  FinishedGameResult,
  FinishSessionResponse,
  PlatformGateway,
  SessionMode,
} from './types.ts';
import { PlatformGatewayError } from './types.ts';

export type AttemptLifecycle =
  | 'initializing'
  | 'active'
  | 'paused'
  | 'finishing'
  | 'finished'
  | 'aborted';
export type ConnectionLifecycle = 'attached' | 'detached';

export interface GameAttemptPort {
  readonly termination: GameAttemptSnapshot['termination'];
  snapshot(): GameAttemptSnapshot;
  assessmentResult(): AssessmentResult;
}

export interface WorkerTimer {
  cancel(): void;
}

export interface WorkerScheduler {
  after(delayMs: number, callback: () => void): WorkerTimer;
}

export interface WorkerClock {
  nowMs(): number;
}

export const systemWorkerClock: WorkerClock = { nowMs: () => performance.now() };
export const systemWorkerScheduler: WorkerScheduler = {
  after: (delayMs, callback) => {
    const handle = setTimeout(callback, delayMs);
    return { cancel: () => clearTimeout(handle) };
  },
};

export interface GameSessionWorkerOptions {
  readonly attemptId: string;
  readonly mode: SessionMode;
  readonly content: ResolvedGameContent;
  readonly attempt: GameAttemptPort;
  readonly projection: PublicGameProjection;
  readonly platformGateway: PlatformGateway;
  readonly resumeTokens: ResumeTokenRegistry;
  readonly disconnectDebounceMs: number;
  readonly reconnectGraceMs: number;
  readonly simulationStepMs?: number;
  readonly maxCatchUpMs?: number;
  readonly allowedTimeScales?: readonly number[];
  readonly clock?: WorkerClock;
  readonly scheduler?: WorkerScheduler;
  readonly finishRetryDelaysMs?: readonly number[];
  readonly logger?: ServerLogger;
  readonly onFinished?: (attemptId: string) => void;
  readonly onAborted?: (attemptId: string) => void;
}

export interface SessionAttachment {
  readonly attemptId: string;
  readonly resumeToken: string;
  readonly lifecycle: AttemptLifecycle;
}

type WorkerPublication = Extract<ServerMessage, { type: 'delta' | 'session-state' }>;
type PublicationListener = (message: WorkerPublication) => void;

const DEFAULT_SIMULATION_STEP_MS = 50;
const DEFAULT_MAX_CATCH_UP_MS = 1_000;
const DEFAULT_TIME_SCALES = [1, 2, 4] as const;
const DEFAULT_FINISH_RETRY_DELAYS_MS = [1_000, 3_000, 10_000] as const;

/** Owns an attempt, not a socket. Wire payload interpretation stays outside this type. */
export class GameSessionWorker {
  private readonly clock: WorkerClock;
  private readonly logger: ServerLogger;
  private readonly scheduler: WorkerScheduler;
  private readonly simulationClock: SimulationClock;
  private readonly simulationStepMs: number;
  private readonly maxCatchUpUs: number;
  private readonly allowedTimeScales: ReadonlySet<number>;
  private lifecycleState: AttemptLifecycle = 'initializing';
  private connectionState: ConnectionLifecycle = 'detached';
  private connectionId: string | null = null;
  private pauseTimer: WorkerTimer | null = null;
  private abortTimer: WorkerTimer | null = null;
  private tickTimer: WorkerTimer | null = null;
  private finishRetryTimer: WorkerTimer | null = null;
  private finishPromise: Promise<FinishSessionResponse> | null = null;
  private finishReceipt: FinishSessionResponse | null = null;
  private readonly finishRetryDelaysMs: readonly number[];
  private nextFinishRetryIndex = 0;
  private readonly publications = new Set<PublicationListener>();
  private nextInputSequence = 0;
  private readonly replayInputs: readonly RecordedReplayInput[];
  private replayInputIndex = 0;
  private replayEnded = false;
  private readonly userInputs: Array<{
    readonly at: number;
    readonly sequence: number;
    readonly command: RecordedGameplayCommand;
  }> = [];

  constructor(private readonly options: GameSessionWorkerOptions) {
    this.clock = options.clock ?? systemWorkerClock;
    this.logger = options.logger ?? createSilentServerLogger();
    this.scheduler = options.scheduler ?? systemWorkerScheduler;
    this.simulationStepMs = positiveInteger(
      options.simulationStepMs ?? DEFAULT_SIMULATION_STEP_MS,
      'simulationStepMs',
    );
    this.maxCatchUpUs = millisecondsToWallUs(
      positiveInteger(options.maxCatchUpMs ?? DEFAULT_MAX_CATCH_UP_MS, 'catch-up window'),
    );
    this.allowedTimeScales = new Set(options.allowedTimeScales ?? DEFAULT_TIME_SCALES);
    this.finishRetryDelaysMs = options.finishRetryDelaysMs ?? DEFAULT_FINISH_RETRY_DELAYS_MS;
    if (this.finishRetryDelaysMs.some((delay) => !nonNegativeInteger(delay))) {
      throw new RangeError('finishRetryDelaysMs must contain non-negative safe integers');
    }
    if (
      this.allowedTimeScales.size === 0 ||
      [...this.allowedTimeScales].some((scale) => !validScale(scale))
    ) {
      throw new RangeError('allowedTimeScales must contain positive finite values');
    }
    const initial = options.attempt.snapshot();
    this.simulationClock = new SimulationClock(this.nowWallUs(), initial.time);
    this.replayInputs =
      options.mode.kind === 'replay' ? parseReplayInputs(options.mode.source.userInputs) : [];
    this.logger.info(
      {
        event: 'worker-initialized',
        mode: options.mode.kind,
        simulationStepMs: this.simulationStepMs,
        maxCatchUpUs: this.maxCatchUpUs,
        replayInputCount: this.replayInputs.length,
      },
      'Attempt worker initialized',
    );
  }

  get attemptId(): string {
    return this.options.attemptId;
  }

  get lifecycle(): AttemptLifecycle {
    return this.lifecycleState;
  }

  get connectionLifecycle(): ConnectionLifecycle {
    return this.connectionState;
  }

  get projection(): PublicGameProjection {
    return this.options.projection;
  }

  isAttachedConnection(connectionId: string): boolean {
    return this.connectionState === 'attached' && this.connectionId === connectionId;
  }

  publicClock(): PublicClockView {
    return {
      timeScale: this.simulationClock.timeScale,
      paused: this.simulationClock.paused || this.lifecycleState === 'paused' || this.replayEnded,
    };
  }

  subscribePublications(listener: PublicationListener): () => void {
    this.publications.add(listener);
    return () => this.publications.delete(listener);
  }

  /** Advances to the authoritative wall horizon before interpreting a client command. */
  synchronizeNow(): void {
    if (this.lifecycleState !== 'active') return;
    this.advanceAtWall(this.nowWallUs());
  }

  /** Publishes a server-controlled public-state mutation after its command result was sent. */
  publishPublicDelta(delta: GameDeltaMessage): void {
    this.publishDelta(delta);
  }

  /** Publishes the projection mutation produced by an accepted gameplay command. */
  acceptProjectionResult(result: InvokeResult): void {
    if (result.recordedCommand !== undefined) {
      this.logger.info(
        {
          event: 'gameplay-command-applied',
          operation: summarizeRecordedCommand(result.recordedCommand),
          revision: result.result.revision,
        },
        'Applied gameplay command',
      );
      this.recordUserInput(result.recordedCommand);
    }
    if (result.delta !== undefined) this.publishDelta(result.delta);
    this.finishIfTerminated();
  }

  setTimeScale(scale: number): GameDeltaMessage {
    if (this.lifecycleState !== 'active') throw new RangeError('Session is not active');
    if (!this.allowedTimeScales.has(scale)) {
      throw new RangeError(`Unsupported time scale ${scale}`);
    }
    const previousScale = this.simulationClock.timeScale;
    this.simulationClock.setTimeScale(scale, this.simulationClock.wallTime);
    this.logger.info(
      { event: 'time-scale-changed', previousScale, scale },
      'Simulation time scale changed',
    );
    return this.options.projection.refresh(this.publicClock());
  }

  recordUserInput(command: RecordedGameplayCommand): void {
    const sequence = this.nextInputSequence;
    this.userInputs.push({
      at: this.options.attempt.snapshot().time,
      sequence,
      command,
    });
    this.nextInputSequence += 1;
    this.logger.debug(
      {
        event: 'user-input-recorded',
        sequence,
        at: this.options.attempt.snapshot().time,
        operation: summarizeRecordedCommand(command),
      },
      'Recorded deterministic user input',
    );
  }

  attach(connectionId: string): SessionAttachment {
    if (
      this.lifecycleState === 'finished' ||
      this.lifecycleState === 'aborted' ||
      this.lifecycleState === 'finishing'
    ) {
      throw new Error(
        `Attempt ${this.attemptId} cannot accept a connection while ${this.lifecycleState}`,
      );
    }

    const nowWallUs = this.nowWallUs();
    this.cancelDisconnectTimers();
    this.connectionId = connectionId;
    this.connectionState = 'attached';
    if (this.lifecycleState === 'paused') {
      this.simulationClock.resume(nowWallUs);
      this.lifecycleState = 'active';
      this.options.projection.refresh(this.publicClock());
    } else if (this.lifecycleState === 'initializing') {
      this.simulationClock.reanchorToProcessed(nowWallUs);
      this.lifecycleState = 'active';
    }
    this.ensureTickScheduled();
    this.logger.info(
      {
        event: 'worker-attached',
        connectionId,
        lifecycle: this.lifecycleState,
        simulationTimeUs: this.options.attempt.snapshot().time,
      },
      'Connection attached to attempt',
    );

    return {
      attemptId: this.attemptId,
      resumeToken: this.options.resumeTokens.issue(this.attemptId),
      lifecycle: this.lifecycleState,
    };
  }

  detach(connectionId: string): void {
    if (this.connectionId !== connectionId || this.connectionState === 'detached') return;
    this.connectionId = null;
    this.connectionState = 'detached';
    this.logger.info(
      {
        event: 'worker-detached',
        connectionId,
        lifecycle: this.lifecycleState,
        simulationTimeUs: this.options.attempt.snapshot().time,
        disconnectDebounceMs: this.options.disconnectDebounceMs,
        reconnectGraceMs: this.options.reconnectGraceMs,
      },
      'Connection detached from attempt',
    );
    if (this.lifecycleState !== 'active') return;
    this.options.resumeTokens.expireAttemptAt(
      this.attemptId,
      this.clock.nowMs() + this.options.disconnectDebounceMs + this.options.reconnectGraceMs,
    );
    this.pauseTimer = this.scheduler.after(this.options.disconnectDebounceMs, () =>
      this.pauseAfterDisconnect(),
    );
    this.abortTimer = this.scheduler.after(
      this.options.disconnectDebounceMs + this.options.reconnectGraceMs,
      () => this.abortAfterGrace(),
    );
  }

  shutdown(): void {
    this.logger.info(
      { event: 'worker-shutdown', lifecycle: this.lifecycleState },
      'Shutting down attempt worker',
    );
    this.cancelDisconnectTimers();
    this.cancelFinishRetry();
    this.cancelTick();
    this.connectionId = null;
    this.connectionState = 'detached';
    this.publications.clear();
    if (this.lifecycleState === 'finished' || this.lifecycleState === 'aborted') return;
    this.lifecycleState = 'aborted';
    this.logger.warn(
      {
        event: 'worker-aborted',
        reason: 'server-shutdown',
        simulationTimeUs: this.options.attempt.snapshot().time,
      },
      'Attempt aborted during server shutdown',
    );
    this.options.resumeTokens.revokeAttempt(this.attemptId);
    this.options.onAborted?.(this.attemptId);
  }

  async finish(): Promise<FinishSessionResponse> {
    if (this.finishReceipt !== null) return this.finishReceipt;
    if (this.finishPromise !== null) return this.finishPromise;
    this.cancelFinishRetry();
    const result = this.finishedResult();
    this.logger.info(
      {
        event: 'finish-start',
        termination: result.termination,
        scores: result.scores,
        userInputCount: result.userInputs.length,
      },
      'Persisting terminal attempt result',
    );
    this.lifecycleState = 'finishing';
    this.options.resumeTokens.revokeAttempt(this.attemptId);
    this.cancelDisconnectTimers();
    this.cancelTick();
    this.publishSessionState('finishing');
    this.finishPromise = this.options.platformGateway
      .finishSession(result)
      .then((receipt) => {
        this.finishReceipt = receipt;
        this.logger.info(
          { event: 'finish-succeeded', resultId: receipt.resultId },
          'Terminal attempt persisted',
        );
        this.lifecycleState = 'finished';
        this.options.resumeTokens.revokeAttempt(this.attemptId);
        this.publishSessionState('finished', receipt.redirectUrl);
        this.options.onFinished?.(this.attemptId);
        return receipt;
      })
      .catch((error: unknown) => {
        this.finishPromise = null;
        this.logger.error(
          {
            err: error,
            event: 'finish-failed',
            retryable: isRetryableFinishError(error),
            retryIndex: this.nextFinishRetryIndex,
          },
          'Terminal attempt persistence failed',
        );
        // The simulation is already terminal. A failed platform handoff must not
        // revive it or restart ticking. Transient failures receive a small bounded
        // retry budget; callers may still invoke finish() explicitly and idempotently.
        this.lifecycleState = 'finishing';
        this.scheduleFinishRetry(error);
        throw error;
      });
    return this.finishPromise;
  }

  private tick(): void {
    this.tickTimer = null;
    this.logger.trace(
      {
        event: 'tick',
        lifecycle: this.lifecycleState,
        simulationTimeUs: this.options.attempt.snapshot().time,
      },
      'Worker tick',
    );
    if (this.lifecycleState !== 'active') return;
    this.advanceAtWall(this.nowWallUs());
    if (this.lifecycleState === 'active') this.ensureTickScheduled();
  }

  private advanceAtWall(nowWallUs: number): void {
    const openGap = nowWallUs - this.simulationClock.wallTime;
    let target: number;
    if (openGap > this.maxCatchUpUs) {
      this.logger.warn(
        {
          event: 'simulation-catchup-clamped',
          openGapUs: openGap,
          maxCatchUpUs: this.maxCatchUpUs,
          simulationTimeUs: this.options.attempt.snapshot().time,
        },
        'Wall-clock gap exceeded catch-up window',
      );
      this.simulationClock.reanchorToProcessed(nowWallUs);
      target = this.simulationClock.processedSimulationTime;
    } else {
      target = this.simulationClock.mapWallTime(nowWallUs);
    }

    const current = this.options.attempt.snapshot().time;
    if (current > this.simulationClock.processedSimulationTime) {
      this.simulationClock.advanceProcessedTo(current);
    }
    target = Math.max(target, current);
    if (this.options.mode.kind === 'replay') {
      this.advanceReplayTo(target);
      return;
    }
    const beforeSnapshot = this.options.attempt.snapshot();
    const delta = this.options.projection.advanceTo(target, this.publicClock());
    const afterSnapshot = this.options.attempt.snapshot();
    const applied = afterSnapshot.time;
    logMovementTransition(
      this.logger,
      this.options.projection.attempt.playerId,
      beforeSnapshot,
      afterSnapshot,
      delta,
    );
    this.simulationClock.advanceProcessedTo(applied);
    this.publishDelta(delta);
    this.finishIfTerminated();
  }

  private advanceReplayTo(target: number): void {
    while (this.replayInputIndex < this.replayInputs.length) {
      const input = this.replayInputs[this.replayInputIndex];
      if (input === undefined || input.at > target || this.options.attempt.termination !== null)
        break;

      const advanceDelta = this.options.projection.advanceTo(input.at, this.publicClock());
      this.publishDelta(advanceDelta);
      this.simulationClock.advanceProcessedTo(this.options.attempt.snapshot().time);

      if (this.options.attempt.termination !== null) break;
      this.logger.debug(
        {
          event: 'replay-input-apply',
          replayIndex: this.replayInputIndex,
          at: input.at,
          operation: summarizeRecordedCommand(input.command),
        },
        'Applying replay input',
      );
      const commandDelta = this.options.projection.applyReplayCommand(
        input.command,
        this.publicClock(),
      );
      this.publishDelta(commandDelta);
      this.replayInputIndex += 1;
      this.simulationClock.advanceProcessedTo(this.options.attempt.snapshot().time);
    }

    if (this.options.attempt.termination === null) {
      const finalDelta = this.options.projection.advanceTo(target, this.publicClock());
      this.publishDelta(finalDelta);
      this.simulationClock.advanceProcessedTo(this.options.attempt.snapshot().time);
    }
    if (this.options.attempt.termination !== null && !this.replayEnded) {
      this.replayEnded = true;
      this.cancelTick();
      this.publishDelta(this.options.projection.refresh(this.publicClock()));
    }
  }

  private finishIfTerminated(): void {
    if (this.options.attempt.termination === null || this.lifecycleState !== 'active') return;
    this.logger.info(
      {
        event: 'terminal-detected',
        termination: this.options.attempt.termination,
        simulationTimeUs: this.options.attempt.snapshot().time,
      },
      'Attempt reached terminal state',
    );
    void this.finish().catch(() => undefined);
  }

  private pauseAfterDisconnect(): void {
    this.pauseTimer = null;
    if (this.connectionState !== 'detached' || this.lifecycleState !== 'active') return;
    const nowWallUs = this.nowWallUs();
    this.advanceAtWall(nowWallUs);
    if (this.lifecycleState !== 'active') return;
    this.simulationClock.pause(nowWallUs);
    this.lifecycleState = 'paused';
    this.logger.info(
      { event: 'worker-paused', simulationTimeUs: this.options.attempt.snapshot().time },
      'Attempt paused after disconnect debounce',
    );
    this.cancelTick();
    this.options.projection.refresh(this.publicClock());
  }

  private abortAfterGrace(): void {
    this.abortTimer = null;
    if (
      this.connectionState !== 'detached' ||
      this.lifecycleState === 'finished' ||
      this.lifecycleState === 'finishing'
    )
      return;
    this.lifecycleState = 'aborted';
    this.logger.warn(
      {
        event: 'worker-aborted',
        reason: 'reconnect-grace-expired',
        simulationTimeUs: this.options.attempt.snapshot().time,
      },
      'Attempt aborted after reconnect grace',
    );
    this.cancelTick();
    this.options.resumeTokens.revokeAttempt(this.attemptId);
    this.publishSessionState('aborted');
    this.options.onAborted?.(this.attemptId);
  }

  private ensureTickScheduled(): void {
    if (this.tickTimer !== null || this.lifecycleState !== 'active' || this.replayEnded) return;
    this.logger.trace(
      { event: 'tick-scheduled', delayMs: this.simulationStepMs },
      'Scheduled worker tick',
    );
    this.tickTimer = this.scheduler.after(this.simulationStepMs, () => this.tick());
  }

  private cancelTick(): void {
    if (this.tickTimer !== null)
      this.logger.trace({ event: 'tick-cancelled' }, 'Cancelled worker tick');
    this.tickTimer?.cancel();
    this.tickTimer = null;
  }

  private scheduleFinishRetry(error: unknown): void {
    if (!isRetryableFinishError(error)) {
      this.logger.warn(
        { event: 'finish-retry-not-scheduled', reason: 'non-retryable' },
        'Finish retry not scheduled',
      );
      return;
    }
    const delayMs = this.finishRetryDelaysMs[this.nextFinishRetryIndex];
    if (delayMs === undefined) {
      this.logger.error(
        { event: 'finish-retry-exhausted', retryCount: this.nextFinishRetryIndex },
        'Finish retry budget exhausted',
      );
      return;
    }
    this.nextFinishRetryIndex += 1;
    this.logger.warn(
      { event: 'finish-retry-scheduled', delayMs, retryNumber: this.nextFinishRetryIndex },
      'Scheduled finish retry',
    );
    this.finishRetryTimer = this.scheduler.after(delayMs, () => {
      this.finishRetryTimer = null;
      if (this.lifecycleState !== 'finishing' || this.finishReceipt !== null) return;
      void this.finish().catch(() => undefined);
    });
  }

  private cancelFinishRetry(): void {
    this.finishRetryTimer?.cancel();
    this.finishRetryTimer = null;
  }

  private publishDelta(delta: GameDeltaMessage): void {
    if (delta.revision === delta.baseRevision) return;
    this.logger.debug(
      {
        event: 'delta-published',
        baseRevision: delta.baseRevision,
        revision: delta.revision,
        changeKeys: Object.keys(delta.changes),
        entityUpserts:
          delta.changes.entities?.upsert.map((entity) => ({
            id: entity.id,
            kind: entity.kind,
            position: entity.position,
          })) ?? [],
        entityRemovals: delta.changes.entities?.removeIds ?? [],
      },
      'Publishing public delta',
    );
    this.publish(delta);
  }

  private publishSessionState(
    state: Extract<AttemptLifecycle, 'active' | 'paused' | 'finishing' | 'finished' | 'aborted'>,
    redirectUrl?: string,
  ): void {
    this.logger.info(
      { event: 'session-state-published', state },
      'Publishing session lifecycle state',
    );
    this.publish({
      protocolVersion: GAME_PROTOCOL_VERSION,
      type: 'session-state',
      attemptId: this.attemptId,
      state,
      ...(redirectUrl === undefined ? {} : { redirectUrl }),
    });
  }

  private publish(message: WorkerPublication): void {
    for (const listener of this.publications) listener(message);
  }

  private cancelDisconnectTimers(): void {
    this.pauseTimer?.cancel();
    this.abortTimer?.cancel();
    this.pauseTimer = null;
    this.abortTimer = null;
  }

  private nowWallUs(): number {
    return millisecondsToWallUs(this.clock.nowMs());
  }

  private finishedResult(): FinishedGameResult {
    const snapshot = this.options.attempt.snapshot();
    const termination = this.options.attempt.termination;
    if (termination === null)
      throw new Error(`Attempt ${this.attemptId} has not reached a terminal state`);
    const assessment = this.options.attempt.assessmentResult();
    return {
      attemptId: this.attemptId,
      content: {
        gameLevelId: this.options.content.gameLevelId,
        gameLevelVersion: this.options.content.gameLevelVersion,
        simulationCompatibilityVersion: this.options.content.simulationCompatibilityVersion,
      },
      rootSeed: String(snapshot.rootSeed),
      userInputs: [...this.userInputs],
      achievements: assessment.achievements,
      termination: {
        kind: termination.kind,
        outcomeId:
          termination.kind === 'route-completed' ? 'route-completed' : termination.outcomeId,
      },
      scores: assessment.scores,
    };
  }
}

function summarizeRecordedCommand(command: RecordedGameplayCommand): Record<string, unknown> {
  switch (command.kind) {
    case 'move':
      return { kind: command.kind, edgeId: command.edgeId };
    case 'move-to':
      return { kind: command.kind, targetCellId: command.targetCellId };
    case 'take-consumable':
      return { kind: command.kind, itemKind: command.itemKind };
    case 'give-held-item':
    case 'use-extinguisher':
      return { kind: command.kind, targetId: command.targetId };
    case 'inspect-extinguisher':
      return { kind: command.kind, removePin: command.value.removePin };
    case 'inspect-climate':
      return { kind: command.kind, refresh: command.value.refresh };
    case 'inspect-emergency-brake':
      return { kind: command.kind, action: command.value.action };
    case 'decide-passenger-boarding':
      return { kind: command.kind, targetId: command.targetId, decision: command.value.decision };
    case 'edit-journal':
      return { kind: command.kind };
    default:
      return { kind: command.kind };
  }
}

function logMovementTransition(
  logger: ServerLogger,
  playerId: string,
  before: GameAttemptSnapshot,
  after: GameAttemptSnapshot,
  delta: GameDeltaMessage,
): void {
  const beforePlayer = before.entities.find((entity) => entity.id === playerId);
  const afterPlayer = after.entities.find((entity) => entity.id === playerId);
  if (beforePlayer === undefined || afterPlayer === undefined) return;
  if (JSON.stringify(beforePlayer.position) === JSON.stringify(afterPlayer.position)) return;
  logger.info(
    {
      event: 'player-movement-progress',
      from: beforePlayer.position,
      to: afterPlayer.position,
      simulationTimeUs: after.time,
      revision: delta.revision,
    },
    'Player movement progressed',
  );
}

function millisecondsToWallUs(milliseconds: number): number {
  if (typeof milliseconds !== 'number' || !Number.isFinite(milliseconds) || milliseconds < 0) {
    throw new RangeError('Worker wall time must be a non-negative finite number');
  }
  const microseconds = Math.round(milliseconds * 1_000);
  if (!Number.isSafeInteger(microseconds)) throw new RangeError('Worker wall time overflow');
  return microseconds;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${label} must be positive`);
  return value;
}

function validScale(value: number): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function nonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function isRetryableFinishError(error: unknown): boolean {
  return (
    error instanceof PlatformGatewayError &&
    (error.kind === 'unavailable' || error.kind === 'timeout')
  );
}
