import type { GameAttemptSnapshot } from '../simulation/game-attempt.ts';
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

export const systemWorkerClock: WorkerClock = { nowMs: () => Date.now() };
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
  readonly platformGateway: PlatformGateway;
  readonly resumeTokens: ResumeTokenRegistry;
  readonly disconnectDebounceMs: number;
  readonly reconnectGraceMs: number;
  readonly clock?: WorkerClock;
  readonly scheduler?: WorkerScheduler;
  readonly onAborted?: (attemptId: string) => void;
}

export interface SessionAttachment {
  readonly attemptId: string;
  readonly resumeToken: string;
  readonly lifecycle: AttemptLifecycle;
}

/** Owns an attempt, not a socket. Wire payload interpretation stays outside this type. */
export class GameSessionWorker {
  private readonly clock: WorkerClock;
  private readonly scheduler: WorkerScheduler;
  private lifecycleState: AttemptLifecycle = 'initializing';
  private connectionState: ConnectionLifecycle = 'detached';
  private connectionId: string | null = null;
  private pauseTimer: WorkerTimer | null = null;
  private abortTimer: WorkerTimer | null = null;
  private finishPromise: Promise<FinishSessionResponse> | null = null;
  private finishReceipt: FinishSessionResponse | null = null;

  constructor(private readonly options: GameSessionWorkerOptions) {
    this.clock = options.clock ?? systemWorkerClock;
    this.scheduler = options.scheduler ?? systemWorkerScheduler;
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
    this.cancelDisconnectTimers();
    this.connectionId = connectionId;
    this.connectionState = 'attached';
    this.lifecycleState = 'active';
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

  async finish(): Promise<FinishSessionResponse> {
    if (this.finishReceipt !== null) return this.finishReceipt;
    if (this.finishPromise !== null) return this.finishPromise;
    const result = this.finishedResult();
    this.lifecycleState = 'finishing';
    this.cancelDisconnectTimers();
    this.finishPromise = this.options.platformGateway
      .finishSession(result)
      .then((receipt) => {
        this.finishReceipt = receipt;
        this.lifecycleState = 'finished';
        this.options.resumeTokens.revokeAttempt(this.attemptId);
        return receipt;
      })
      .catch((error: unknown) => {
        this.finishPromise = null;
        this.lifecycleState = this.connectionState === 'attached' ? 'active' : 'paused';
        throw error;
      });
    return this.finishPromise;
  }

  private pauseAfterDisconnect(): void {
    this.pauseTimer = null;
    if (this.connectionState === 'detached' && this.lifecycleState === 'active')
      this.lifecycleState = 'paused';
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
    this.options.resumeTokens.revokeAttempt(this.attemptId);
    this.options.onAborted?.(this.attemptId);
  }

  private cancelDisconnectTimers(): void {
    this.pauseTimer?.cancel();
    this.abortTimer?.cancel();
    this.pauseTimer = null;
    this.abortTimer = null;
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
      userInputs: [],
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
