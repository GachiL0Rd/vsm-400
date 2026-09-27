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
import type { GameAttemptSnapshot } from '../simulation/game-attempt.ts';
import { SimulationClock } from '../simulation/simulation-clock.ts';
import type { ResolvedGameContent } from './content-registry.ts';
import type { ResumeTokenRegistry } from './resume-token-registry.ts';
import type {
  FinishedGameResult,
  FinishSessionResponse,
  PlatformGateway,
  SessionMode,
} from './types.ts';

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

/** Owns an attempt, not a socket. Wire payload interpretation stays outside this type. */
export class GameSessionWorker {
  private readonly clock: WorkerClock;
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
  private finishPromise: Promise<FinishSessionResponse> | null = null;
  private finishReceipt: FinishSessionResponse | null = null;
  private readonly publications = new Set<PublicationListener>();
  private nextInputSequence = 0;
  private readonly userInputs: Array<{
    readonly at: number;
    readonly sequence: number;
    readonly command: RecordedGameplayCommand;
  }> = [];

  constructor(private readonly options: GameSessionWorkerOptions) {
    this.clock = options.clock ?? systemWorkerClock;
    this.scheduler = options.scheduler ?? systemWorkerScheduler;
    this.simulationStepMs = positiveInteger(
      options.simulationStepMs ?? DEFAULT_SIMULATION_STEP_MS,
      'simulationStepMs',
    );
    this.maxCatchUpUs = millisecondsToWallUs(
      positiveInteger(options.maxCatchUpMs ?? DEFAULT_MAX_CATCH_UP_MS, 'catch-up window'),
    );
    this.allowedTimeScales = new Set(options.allowedTimeScales ?? DEFAULT_TIME_SCALES);
    if (
      this.allowedTimeScales.size === 0 ||
      [...this.allowedTimeScales].some((scale) => !validScale(scale))
    ) {
      throw new RangeError('allowedTimeScales must contain positive finite values');
    }
    const initial = options.attempt.snapshot();
    this.simulationClock = new SimulationClock(this.nowWallUs(), initial.time);
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
      paused: this.simulationClock.paused || this.lifecycleState === 'paused',
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

  /** Publishes the projection mutation produced by an accepted gameplay command. */
  acceptProjectionResult(result: InvokeResult): void {
    if (result.recordedCommand !== undefined) this.recordUserInput(result.recordedCommand);
    if (result.delta !== undefined) this.publishDelta(result.delta);
    this.finishIfTerminated();
  }

  setTimeScale(scale: number): number {
    if (this.lifecycleState !== 'active') throw new RangeError('Session is not active');
    if (!this.allowedTimeScales.has(scale)) {
      throw new RangeError(`Unsupported time scale ${scale}`);
    }
    this.simulationClock.setTimeScale(scale, this.simulationClock.wallTime);
    const delta = this.options.projection.refresh(this.publicClock());
    this.publishDelta(delta);
    return this.options.projection.revision;
  }

  recordUserInput(command: RecordedGameplayCommand): void {
    this.userInputs.push({
      at: this.options.attempt.snapshot().time,
      sequence: this.nextInputSequence,
      command,
    });
    this.nextInputSequence += 1;
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

    const expiresAt =
      this.clock.nowMs() + this.options.disconnectDebounceMs + this.options.reconnectGraceMs;
    return {
      attemptId: this.attemptId,
      resumeToken: this.options.resumeTokens.issue(this.attemptId, expiresAt),
      lifecycle: this.lifecycleState,
    };
  }

  detach(connectionId: string): void {
    if (this.connectionId !== connectionId || this.connectionState === 'detached') return;
    this.connectionId = null;
    this.connectionState = 'detached';
    if (this.lifecycleState !== 'active') return;
    this.pauseTimer = this.scheduler.after(this.options.disconnectDebounceMs, () =>
      this.pauseAfterDisconnect(),
    );
    this.abortTimer = this.scheduler.after(
      this.options.disconnectDebounceMs + this.options.reconnectGraceMs,
      () => this.abortAfterGrace(),
    );
  }

  shutdown(): void {
    this.cancelDisconnectTimers();
    this.cancelTick();
    this.connectionId = null;
    this.connectionState = 'detached';
    this.publications.clear();
    if (this.lifecycleState === 'finished' || this.lifecycleState === 'aborted') return;
    this.lifecycleState = 'aborted';
    this.options.resumeTokens.revokeAttempt(this.attemptId);
    this.options.onAborted?.(this.attemptId);
  }

  async finish(): Promise<FinishSessionResponse> {
    if (this.finishReceipt !== null) return this.finishReceipt;
    if (this.finishPromise !== null) return this.finishPromise;
    const result = this.finishedResult();
    this.lifecycleState = 'finishing';
    this.cancelDisconnectTimers();
    this.cancelTick();
    this.publishSessionState('finishing');
    this.finishPromise = this.options.platformGateway
      .finishSession(result)
      .then((receipt) => {
        this.finishReceipt = receipt;
        this.lifecycleState = 'finished';
        this.options.resumeTokens.revokeAttempt(this.attemptId);
        this.publishSessionState('finished', receipt.redirectUrl);
        return receipt;
      })
      .catch((error: unknown) => {
        this.finishPromise = null;
        this.lifecycleState = this.connectionState === 'attached' ? 'active' : 'paused';
        if (this.lifecycleState === 'active') this.ensureTickScheduled();
        this.publishSessionState(this.lifecycleState);
        throw error;
      });
    return this.finishPromise;
  }

  private tick(): void {
    this.tickTimer = null;
    if (this.lifecycleState !== 'active') return;
    this.advanceAtWall(this.nowWallUs());
    if (this.lifecycleState === 'active') this.ensureTickScheduled();
  }

  private advanceAtWall(nowWallUs: number): void {
    const openGap = nowWallUs - this.simulationClock.wallTime;
    let target: number;
    if (openGap > this.maxCatchUpUs) {
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
    const delta = this.options.projection.advanceTo(target, this.publicClock());
    const applied = this.options.attempt.snapshot().time;
    this.simulationClock.advanceProcessedTo(applied);
    this.publishDelta(delta);
    this.finishIfTerminated();
  }

  private finishIfTerminated(): void {
    if (this.options.attempt.termination === null || this.lifecycleState !== 'active') return;
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
    this.cancelTick();
    this.options.resumeTokens.revokeAttempt(this.attemptId);
    this.publishSessionState('aborted');
    this.options.onAborted?.(this.attemptId);
  }

  private ensureTickScheduled(): void {
    if (this.tickTimer !== null || this.lifecycleState !== 'active') return;
    this.tickTimer = this.scheduler.after(this.simulationStepMs, () => this.tick());
  }

  private cancelTick(): void {
    this.tickTimer?.cancel();
    this.tickTimer = null;
  }

  private publishDelta(delta: GameDeltaMessage): void {
    if (delta.revision === delta.baseRevision) return;
    this.publish(delta);
  }

  private publishSessionState(
    state: Extract<AttemptLifecycle, 'active' | 'paused' | 'finishing' | 'finished' | 'aborted'>,
    redirectUrl?: string,
  ): void {
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
    return {
      attemptId: this.attemptId,
      content: {
        gameLevelId: this.options.content.gameLevelId,
        gameLevelVersion: this.options.content.gameLevelVersion,
        simulationCompatibilityVersion: this.options.content.simulationCompatibilityVersion,
      },
      rootSeed: String(snapshot.rootSeed),
      userInputs: [...this.userInputs],
      achievements: { setVersion: 'unimplemented', ids: [] },
      termination: {
        kind: termination.kind,
        outcomeId:
          termination.kind === 'route-completed' ? 'route-completed' : termination.outcomeId,
      },
      scores: { safety: 0, customerSatisfaction: 0 },
    };
  }
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
