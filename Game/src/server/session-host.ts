import { randomBytes } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { SessionModeView } from '../common/game-wire.ts';
import { PublicGameProjection } from '../projection/public-game-session.ts';
import type { GameContentRegistry } from './content-registry.ts';
import {
  GameSessionWorker,
  type SessionAttachment,
  systemWorkerClock,
  type WorkerClock,
  type WorkerScheduler,
} from './game-session-worker.ts';
import type { ResumeTokenRegistry } from './resume-token-registry.ts';
import type { PlatformGateway, SessionMode } from './types.ts';

interface HostedWorker {
  readonly worker: GameSessionWorker;
  readonly gameLevelId: string;
  readonly mode: SessionMode;
}

export interface GameSessionHostOptions {
  readonly platformGateway: PlatformGateway;
  readonly contentRegistry: GameContentRegistry;
  readonly resumeTokens: ResumeTokenRegistry;
  readonly disconnectDebounceMs: number;
  readonly reconnectGraceMs: number;
  readonly simulationStepMs?: number;
  readonly maxCatchUpMs?: number;
  readonly allowedTimeScales?: readonly number[];
  readonly finishRetryDelaysMs?: readonly number[];
  readonly clock?: WorkerClock;
  readonly scheduler?: WorkerScheduler;
}

/** Maps authenticated platform attempts to durable-in-memory workers. */
export class GameSessionHost {
  private readonly workers = new Map<string, HostedWorker>();
  private readonly clock: WorkerClock;

  constructor(private readonly options: GameSessionHostOptions) {
    this.clock = options.clock ?? systemWorkerClock;
  }

  async attachWithSessionKey(sessionKey: string, connectionId: string): Promise<SessionAttachment> {
    const resolved = await this.options.platformGateway.resolveSession(sessionKey);
    const existing = this.workers.get(resolved.attemptId);
    if (existing !== undefined) {
      assertSameResolvedSession(existing, resolved.gameLevelId, resolved.mode);
      return existing.worker.attach(connectionId);
    }

    {
      const content = this.options.contentRegistry.resolve(resolved.gameLevelId);
      assertReplayCompatible(resolved.mode, content);
      const seed = rootSeed(
        resolved.mode.kind === 'replay' ? resolved.mode.source.rootSeed : undefined,
      );
      const attempt = content.createAttempt(seed, resolved.mode);
      const worker = new GameSessionWorker({
        attemptId: resolved.attemptId,
        mode: resolved.mode,
        content,
        attempt,
        projection: new PublicGameProjection({
          attemptId: resolved.attemptId,
          attempt,
          mode: publicMode(resolved.mode),
        }),
        platformGateway: this.options.platformGateway,
        resumeTokens: this.options.resumeTokens,
        disconnectDebounceMs: this.options.disconnectDebounceMs,
        reconnectGraceMs: this.options.reconnectGraceMs,
        ...(this.options.simulationStepMs === undefined
          ? {}
          : { simulationStepMs: this.options.simulationStepMs }),
        ...(this.options.maxCatchUpMs === undefined
          ? {}
          : { maxCatchUpMs: this.options.maxCatchUpMs }),
        ...(this.options.allowedTimeScales === undefined
          ? {}
          : { allowedTimeScales: this.options.allowedTimeScales }),
        ...(this.options.finishRetryDelaysMs === undefined
          ? {}
          : { finishRetryDelaysMs: this.options.finishRetryDelaysMs }),
        clock: this.clock,
        ...(this.options.scheduler === undefined ? {} : { scheduler: this.options.scheduler }),
        onFinished: (attemptId) => this.workers.delete(attemptId),
        onAborted: (attemptId) => this.workers.delete(attemptId),
      });
      this.workers.set(resolved.attemptId, {
        worker,
        gameLevelId: resolved.gameLevelId,
        mode: resolved.mode,
      });
      return worker.attach(connectionId);
    }
  }

  attachWithResumeToken(resumeToken: string, connectionId: string): SessionAttachment {
    const nowMs = this.clock.nowMs();
    const attemptId = this.options.resumeTokens.resolve(resumeToken, nowMs);
    if (attemptId === null) throw new Error('Invalid or expired resume token');
    const hosted = this.workers.get(attemptId);
    if (hosted === undefined) throw new Error('Attempt is not available for resume');
    return hosted.worker.attach(connectionId);
  }

  detach(attemptId: string, connectionId: string): void {
    this.workers.get(attemptId)?.worker.detach(connectionId);
  }

  worker(attemptId: string): GameSessionWorker | undefined {
    return this.workers.get(attemptId)?.worker;
  }

  shutdown(): void {
    for (const { worker } of this.workers.values()) worker.shutdown();
    this.workers.clear();
  }
}

function assertSameResolvedSession(
  existing: HostedWorker,
  gameLevelId: string,
  mode: SessionMode,
): void {
  if (existing.gameLevelId !== gameLevelId || !isDeepStrictEqual(existing.mode, mode)) {
    throw new Error('Platform returned conflicting launch data for an existing attempt');
  }
}

function rootSeed(replaySeed: string | undefined): number {
  if (replaySeed !== undefined) {
    const parsed = Number(replaySeed);
    if (Number.isSafeInteger(parsed) && parsed >= 0) return parsed;
    throw new RangeError('Replay root seed must be a non-negative safe integer');
  }
  return randomBytes(4).readUInt32BE(0);
}

function publicMode(mode: SessionMode): SessionModeView {
  switch (mode.kind) {
    case 'live':
      return { kind: 'live' };
    case 'guided':
      return {
        kind: 'guided',
        hints: {
          immediateFeedback: mode.hints.immediateFeedback,
          suggestions: mode.hints.suggestions,
          objectHighlights: mode.hints.highlights,
          explanations: mode.hints.explanations,
        },
      };
    case 'replay':
      return {
        kind: 'replay',
        capabilities: {
          seek: false,
          speeds: [1, 2, 4],
          entityInspection: false,
          revealTraits: false,
          revealActionScores: false,
          revealAssessment: false,
        },
      };
  }
}

function assertReplayCompatible(
  mode: SessionMode,
  content: {
    readonly gameLevelVersion: string;
    readonly simulationCompatibilityVersion: string;
  },
): void {
  if (mode.kind !== 'replay') return;
  if (mode.source.gameLevelVersion !== content.gameLevelVersion) {
    throw new RangeError(
      `Replay game level version ${mode.source.gameLevelVersion} does not match ${content.gameLevelVersion}`,
    );
  }
  if (mode.source.simulationCompatibilityVersion !== content.simulationCompatibilityVersion) {
    throw new RangeError(
      `Replay simulation compatibility version ${mode.source.simulationCompatibilityVersion} does not match ${content.simulationCompatibilityVersion}`,
    );
  }
}
