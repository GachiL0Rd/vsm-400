import { describe, expect, it } from 'vitest';
import type { ServerMessage } from '../common/game-wire.ts';
import { PublicGameProjection } from '../projection/public-game-session.ts';
import { GameAttempt } from '../simulation/game-attempt.ts';
import { BASELINE_LEVEL } from '../simulation/level.ts';
import { BASELINE_SCENARIO_DEFINITION, loadScenarioDefinition } from '../simulation/scenario.ts';
import { BaselineContentRegistry } from './content-registry.ts';
import { finishedGameResultSchema } from './finished-game-result.schema.ts';
import {
  GameSessionWorker,
  type WorkerClock,
  type WorkerScheduler,
  type WorkerTimer,
} from './game-session-worker.ts';
import { MockPlatformGateway, mockMode } from './platform-gateway.ts';
import { InMemoryResumeTokenRegistry } from './resume-token-registry.ts';
import type {
  FinishedGameResult,
  FinishSessionResponse,
  PlatformGateway,
  SessionMode,
} from './types.ts';
import { PlatformGatewayError } from './types.ts';

class FakeRuntime implements WorkerScheduler, WorkerClock {
  private now = 0;
  private readonly tasks: Array<{ at: number; active: boolean; callback: () => void }> = [];

  nowMs(): number {
    return this.now;
  }

  after(delayMs: number, callback: () => void): WorkerTimer {
    const task = { at: this.now + delayMs, active: true, callback };
    this.tasks.push(task);
    return {
      cancel: () => {
        task.active = false;
      },
    };
  }

  advanceBy(milliseconds: number): void {
    this.now += milliseconds;
    for (const task of this.tasks.filter(
      (candidate) => candidate.active && candidate.at <= this.now,
    )) {
      task.active = false;
      task.callback();
    }
  }
}

function worker(
  runtime: FakeRuntime,
  attempt = new GameAttempt({ rootSeed: 5 }),
  options: {
    simulationStepMs?: number;
    maxCatchUpMs?: number;
    reconnectGraceMs?: number;
    finishRetryDelaysMs?: readonly number[];
  } = {},
) {
  const registry = new InMemoryResumeTokenRegistry();
  const gateway = new MockPlatformGateway({
    attemptId: 'attempt-1',
    gameLevelId: 'vsm-baseline-01',
    mode: mockMode('live'),
  });
  return {
    registry,
    gateway,
    value: new GameSessionWorker({
      attemptId: 'attempt-1',
      mode: mockMode('live'),
      content: new BaselineContentRegistry().resolve('vsm-baseline-01'),
      attempt,
      projection: new PublicGameProjection({ attemptId: 'attempt-1', attempt }),
      platformGateway: gateway,
      resumeTokens: registry,
      disconnectDebounceMs: 10,
      reconnectGraceMs: options.reconnectGraceMs ?? 20,
      simulationStepMs: options.simulationStepMs ?? 50,
      maxCatchUpMs: options.maxCatchUpMs ?? 1_000,
      ...(options.finishRetryDelaysMs === undefined
        ? {}
        : { finishRetryDelaysMs: options.finishRetryDelaysMs }),
      scheduler: runtime,
      clock: runtime,
    }),
  };
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function completeJournal(attempt: GameAttempt): void {
  attempt.takeJournal();
  attempt.editJournal({
    communication: 'ok',
    extinguisher: 'ok',
    climate: 'ok',
    emergencyBrake: 'ok',
    sanitation: 'clean',
    note: '',
    accepted: true,
  });
  attempt.returnJournal();
}

function quietScenario() {
  return loadScenarioDefinition({ ...BASELINE_SCENARIO_DEFINITION, incidents: [] }, BASELINE_LEVEL);
}

function resolveOriginBoarding(attempt: GameAttempt): void {
  attempt.advanceTo(5 * 60 * 1_000_000);
  attempt.decidePassengerBoarding('passenger-1', 'admit');
  attempt.decidePassengerBoarding('passenger-2', 'admit');
  attempt.decidePassengerBoarding('passenger-3', 'reject');
}

class FailOncePlatformGateway implements PlatformGateway {
  finishAttempts = 0;

  async resolveSession(): Promise<never> {
    throw new Error('not used');
  }

  async finishSession(_result: FinishedGameResult): Promise<FinishSessionResponse> {
    this.finishAttempts += 1;
    if (this.finishAttempts === 1) {
      throw new PlatformGatewayError('unavailable', 'platform unavailable');
    }
    return { resultId: 'result-1', redirectUrl: 'http://localhost/results/attempt-1' };
  }
}

describe('GameSessionWorker', () => {
  it('keeps only the latest resume token and starts its expiry window on disconnect', () => {
    const registry = new InMemoryResumeTokenRegistry();
    const first = registry.issue('attempt-1');

    expect(registry.validate(first, 'attempt-1', 10_000)).toBe(true);
    expect(registry.resolve(first, 10_000)).toBe('attempt-1');
    expect(registry.validate(first, 'another-attempt', 10_000)).toBe(false);

    const second = registry.issue('attempt-1');
    expect(registry.resolve(first, 10_000)).toBeNull();
    expect(registry.resolve(second, 20_000)).toBe('attempt-1');

    registry.expireAttemptAt('attempt-1', 20_010);
    expect(registry.validate(second, 'attempt-1', 20_010)).toBe(true);
    expect(registry.validate(second, 'attempt-1', 20_011)).toBe(false);
    expect(registry.resolve(second, 20_011)).toBeNull();
  });

  it('keeps the delivered resume token valid during a long active connection, then expires it after disconnect grace', () => {
    const runtime = new FakeRuntime();
    const { value, registry } = worker(runtime);
    const attachment = value.attach('socket-1');

    runtime.advanceBy(60_000);
    expect(registry.resolve(attachment.resumeToken, runtime.nowMs())).toBe('attempt-1');

    value.detach('socket-1');
    expect(registry.resolve(attachment.resumeToken, runtime.nowMs() + 30)).toBe('attempt-1');
    expect(registry.resolve(attachment.resumeToken, runtime.nowMs() + 31)).toBeNull();
  });

  it('pauses only after disconnect debounce and resumes before grace expires without wall catch-up', () => {
    const runtime = new FakeRuntime();
    const { value } = worker(runtime, undefined, { maxCatchUpMs: 10_000 });

    value.attach('socket-1');
    runtime.advanceBy(100);
    const beforeDetach = value.projection.attempt.snapshot().time;
    expect(beforeDetach).toBe(100_000);

    value.detach('socket-1');
    runtime.advanceBy(10);
    expect(value.lifecycle).toBe('paused');
    const pausedAt = value.projection.attempt.snapshot().time;
    expect(pausedAt).toBe(110_000);

    runtime.advanceBy(15);
    expect(value.projection.attempt.snapshot().time).toBe(pausedAt);

    value.attach('socket-2');
    expect(value.lifecycle).toBe('active');
    expect(value.connectionLifecycle).toBe('attached');
    runtime.advanceBy(100);
    expect(value.projection.attempt.snapshot().time).toBe(pausedAt + 100_000);
  });

  it('publishes every authoritative edge while routing toward a remote move-to destination', () => {
    const runtime = new FakeRuntime();
    const attempt = new GameAttempt({ rootSeed: 6 });
    const { value } = worker(runtime, attempt, { maxCatchUpMs: 10_000 });
    value.attach('socket-1');
    value.projection.snapshot(value.publicClock());
    const publications: ServerMessage[] = [];
    value.subscribePublications((message) => publications.push(message));

    const moved = value.projection.moveTo(
      {
        protocolVersion: 1,
        type: 'move-to',
        requestId: 'move-remote',
        knownRevision: 0,
        targetCellId: 'carriage.service',
      },
      value.publicClock(),
    );
    expect(moved.result.status).toBe('accepted');
    value.acceptProjectionResult(moved);

    for (let elapsed = 0; elapsed < 5_000; elapsed += 50) runtime.advanceBy(50);

    expect(attempt.playerPosition()).toEqual({ kind: 'cell', cellId: 'carriage.service' });
    const edgeIds = publications
      .filter(
        (message): message is Extract<ServerMessage, { type: 'delta' }> => message.type === 'delta',
      )
      .flatMap((message) => message.changes.entities?.upsert ?? [])
      .filter((entity) => entity.kind === 'player' && entity.position.kind === 'moving')
      .map((entity) => (entity.position.kind === 'moving' ? entity.position.edgeId : ''));
    expect(new Set(edgeIds)).toEqual(
      new Set([
        'origin-desk-door:forward',
        'origin-door-entry:forward',
        'entry-cabin:forward',
        'cabin-service:forward',
      ]),
    );
  });

  it('freezes a running movement across disconnect pause and resumes from the same simulation instant', () => {
    const runtime = new FakeRuntime();
    const attempt = new GameAttempt({ rootSeed: 6 });
    const { value } = worker(runtime, attempt, { maxCatchUpMs: 10_000, reconnectGraceMs: 10_000 });
    value.attach('socket-1');
    value.projection.snapshot(value.publicClock());

    const moved = value.projection.moveTo(
      {
        protocolVersion: 1,
        type: 'move-to',
        requestId: 'move-1',
        knownRevision: 0,
        targetCellId: 'platform-origin.door',
      },
      value.publicClock(),
    );
    expect(moved.result.status).toBe('accepted');
    value.acceptProjectionResult(moved);

    runtime.advanceBy(100);
    const beforeDetach = attempt.playerPosition();
    expect(beforeDetach.kind).toBe('moving');
    if (beforeDetach.kind !== 'moving') throw new Error('Expected player movement');

    value.detach('socket-1');
    runtime.advanceBy(10);
    const paused = attempt.playerPosition();
    expect(value.lifecycle).toBe('paused');
    expect(paused.kind).toBe('moving');
    if (paused.kind !== 'moving') throw new Error('Expected paused movement');
    const pausedProgress = paused.progress;
    const pausedTime = attempt.time;

    runtime.advanceBy(5_000);
    const stillPaused = attempt.playerPosition();
    expect(attempt.time).toBe(pausedTime);
    expect(stillPaused).toMatchObject({ kind: 'moving', progress: pausedProgress });

    value.attach('socket-2');
    runtime.advanceBy(890);
    const completed = attempt.playerPosition();
    expect(completed).toEqual({ kind: 'cell', cellId: 'platform-origin.door' });
  });

  it('shuts down timers, publications, and resume state without waiting for disconnect grace', () => {
    const runtime = new FakeRuntime();
    const { value, registry } = worker(runtime);
    const attachment = value.attach('socket-1');
    const publications: ServerMessage[] = [];
    value.subscribePublications((message) => publications.push(message));

    value.shutdown();
    runtime.advanceBy(10_000);

    expect(value.lifecycle).toBe('aborted');
    expect(value.connectionLifecycle).toBe('detached');
    expect(registry.validate(attachment.resumeToken, 'attempt-1', runtime.nowMs())).toBe(false);
    expect(publications).toEqual([]);
  });

  it('aborts after the reconnect grace period and revokes resume tokens', () => {
    const runtime = new FakeRuntime();
    const { value, registry } = worker(runtime);
    const attachment = value.attach('socket-1');
    value.detach('socket-1');

    runtime.advanceBy(30);
    expect(value.lifecycle).toBe('aborted');
    expect(registry.validate(attachment.resumeToken, 'attempt-1', runtime.nowMs())).toBe(false);
  });

  it('advances scenario state from the server loop and publishes only meaningful public deltas', () => {
    const runtime = new FakeRuntime();
    const attempt = new GameAttempt({ rootSeed: 7 });
    completeJournal(attempt);
    const { value } = worker(runtime, attempt, { maxCatchUpMs: 10 * 60 * 1_000 });
    const publications: ServerMessage[] = [];
    value.subscribePublications((message) => publications.push(message));
    value.attach('socket-1');
    value.projection.snapshot(value.publicClock());

    runtime.advanceBy(1_000);
    expect(attempt.snapshot().time).toBe(1_000_000);
    expect(value.projection.revision).toBe(0);
    expect(publications).toEqual([]);

    runtime.advanceBy(5 * 60 * 1_000 - 1_000);
    expect(attempt.phase).toEqual({ kind: 'origin-stop' });
    expect(value.projection.revision).toBe(1);
    expect(publications.map((message) => message.type)).toEqual(['delta', 'presentation-event']);
    expect(publications[0]).toMatchObject({
      type: 'delta',
      baseRevision: 0,
      revision: 1,
      changes: { phase: { kind: 'origin-stop' } },
    });
    expect(publications[1]).toMatchObject({
      type: 'presentation-event',
      event: {
        kind: 'notification',
        notificationId: 'phase:origin-stop',
        text: 'Посадка пассажиров открыта',
      },
    });
  });

  it('delivers presentation events produced before the first subscriber once, after subscribing', async () => {
    const runtime = new FakeRuntime();
    const attempt = new GameAttempt({ rootSeed: 7 });
    completeJournal(attempt);
    const { value } = worker(runtime, attempt, { maxCatchUpMs: 10 * 60 * 1_000 });
    value.attach('socket-1');
    value.projection.snapshot(value.publicClock());
    runtime.advanceBy(5 * 60 * 1_000);
    expect(attempt.phase).toEqual({ kind: 'origin-stop' });

    const first: ServerMessage[] = [];
    value.subscribePublications((message) => first.push(message));
    expect(first).toEqual([]);
    await Promise.resolve();
    expect(first).toEqual([
      expect.objectContaining({
        type: 'presentation-event',
        event: expect.objectContaining({ notificationId: 'phase:origin-stop' }),
      }),
    ]);

    const second: ServerMessage[] = [];
    value.subscribePublications((message) => second.push(message));
    await Promise.resolve();
    expect(second).toEqual([]);
  });

  it('changes time scale without a discontinuity and exposes the clock through the projection', () => {
    const runtime = new FakeRuntime();
    const { value } = worker(runtime, undefined, { maxCatchUpMs: 10_000 });
    const publications: ServerMessage[] = [];
    value.subscribePublications((message) => publications.push(message));
    value.attach('socket-1');
    value.projection.snapshot(value.publicClock());

    runtime.advanceBy(100);
    expect(value.projection.attempt.snapshot().time).toBe(100_000);
    const delta = value.setTimeScale(2);
    expect(value.publicClock()).toEqual({ timeScale: 2, paused: false });
    expect(delta).toMatchObject({
      type: 'delta',
      changes: { clock: { timeScale: 2, paused: false } },
    });
    expect(publications).toEqual([]);
    value.publishPublicDelta(delta);
    expect(publications.at(-1)).toMatchObject({
      type: 'delta',
      changes: { clock: { timeScale: 2, paused: false } },
    });

    runtime.advanceBy(100);
    expect(value.projection.attempt.snapshot().time).toBe(300_000);
    expect(() => value.setTimeScale(3)).toThrow(/Unsupported time scale/);
  });

  it('drops an excessive scheduler gap instead of catching up the whole wall interval', () => {
    const runtime = new FakeRuntime();
    const { value } = worker(runtime, undefined, { maxCatchUpMs: 500 });
    value.attach('socket-1');

    runtime.advanceBy(5_000);
    expect(value.projection.attempt.snapshot().time).toBe(0);
    runtime.advanceBy(100);
    expect(value.projection.attempt.snapshot().time).toBe(100_000);
  });

  it('publishes phase notices and each achievement once before finishing', async () => {
    const runtime = new FakeRuntime();
    const attempt = new GameAttempt({ rootSeed: 4, scenario: quietScenario() });
    completeJournal(attempt);
    const { value } = worker(runtime, attempt, {
      maxCatchUpMs: attempt.scenario.normalEndTimeUs / 1_000 + 5 * 60 * 1_000,
    });
    const publications: ServerMessage[] = [];
    value.subscribePublications((message) => publications.push(message));
    value.attach('socket-1');
    value.projection.snapshot(value.publicClock());

    runtime.advanceBy(5 * 60 * 1_000);
    attempt.decidePassengerBoarding('passenger-1', 'admit');
    attempt.decidePassengerBoarding('passenger-2', 'admit');
    attempt.decidePassengerBoarding('passenger-3', 'reject');
    runtime.advanceBy(attempt.scenario.normalEndTimeUs / 1_000);
    await flush();

    expect(value.lifecycle).toBe('finished');
    const notices = publications.flatMap((message) =>
      message.type === 'presentation-event' && message.event.kind === 'notification'
        ? [message.event.notificationId]
        : [],
    );
    expect(notices).toEqual([
      'phase:origin-stop',
      'phase:travel',
      'phase:stop:0',
      'phase:depart:0',
      'phase:stop:1',
      'termination:route-completed',
    ]);
    const achievementIndexes = publications.flatMap((message, index) =>
      message.type === 'presentation-event' && message.event.kind === 'achievement-unlocked'
        ? [index]
        : [],
    );
    const achievementIds = publications.flatMap((message) =>
      message.type === 'presentation-event' && message.event.kind === 'achievement-unlocked'
        ? [message.event.achievementId]
        : [],
    );
    expect(achievementIds).toEqual(['clean-predeparture', 'documents-perfect']);
    const finishingIndex = publications.findIndex(
      (message) => message.type === 'session-state' && message.state === 'finishing',
    );
    expect(finishingIndex).toBeGreaterThan(-1);
    expect(Math.max(...achievementIndexes)).toBeLessThan(finishingIndex);
    expect(
      publications.some(
        (message) => message.type === 'presentation-event' && message.event.kind === 'hint',
      ),
    ).toBe(false);
  });

  it('automatically finalizes a terminal attempt exactly once and publishes finishing/finished', async () => {
    const runtime = new FakeRuntime();
    const attempt = new GameAttempt({ rootSeed: 12 });
    completeJournal(attempt);
    resolveOriginBoarding(attempt);
    const { value, gateway } = worker(runtime, attempt, {
      maxCatchUpMs: attempt.scenario.normalEndTimeUs / 1_000 + 1_000,
    });
    const publications: ServerMessage[] = [];
    value.subscribePublications((message) => publications.push(message));
    value.attach('socket-1');
    value.projection.snapshot(value.publicClock());

    runtime.advanceBy(attempt.scenario.normalEndTimeUs / 1_000);
    await flush();

    expect(value.lifecycle).toBe('finished');
    expect(gateway.finished).toHaveLength(1);
    expect(gateway.finished[0]?.rootSeed).toBe('12');
    expect(gateway.finished[0]?.achievements.setVersion).toBe('baseline-v2');
    expect(gateway.finished[0]?.scores.safety).toBeGreaterThanOrEqual(0);
    expect(gateway.finished[0]?.scores.safety).toBeLessThanOrEqual(100);
    expect(gateway.finished[0]?.scores.customerSatisfaction).toBeGreaterThanOrEqual(0);
    expect(gateway.finished[0]?.scores.customerSatisfaction).toBeLessThanOrEqual(100);
    const finished = gateway.finished[0];
    expect(finished).toBeDefined();
    if (finished === undefined) return;
    expect(finishedGameResultSchema.parse(JSON.parse(JSON.stringify(finished)))).toEqual(finished);
    expect(finished.assessment?.setVersion).toBe(finished.achievements.setVersion);
    expect(finished.assessment?.durationUs).toBe(attempt.termination?.at);
    expect(finished.assessment?.facts.length).toBeGreaterThan(0);
    const deltas = finished.assessment?.facts ?? [];
    const safety = deltas.reduce((sum, fact) => sum + fact.scoreDelta.safety, 0);
    const loyalty = deltas.reduce((sum, fact) => sum + fact.scoreDelta.customerSatisfaction, 0);
    expect(finished.scores.safety).toBe(Math.max(0, Math.min(100, Math.round(100 + safety))));
    expect(finished.scores.customerSatisfaction).toBe(
      Math.max(0, Math.min(100, Math.round(100 + loyalty))),
    );
    expect(
      publications.map((message) => message.type === 'session-state' && message.state),
    ).toContain('finishing');
    expect(publications.at(-1)).toMatchObject({
      type: 'session-state',
      state: 'finished',
      redirectUrl: 'http://localhost/results/attempt-1',
    });

    await value.finish();
    expect(gateway.finished).toHaveLength(1);
  });

  it('keeps a terminal attempt frozen and automatically retries a transient platform finalization failure', async () => {
    const runtime = new FakeRuntime();
    const attempt = new GameAttempt({ rootSeed: 13 });
    const gateway = new FailOncePlatformGateway();
    const content = new BaselineContentRegistry().resolve('vsm-baseline-01');
    const registry = new InMemoryResumeTokenRegistry();
    const value = new GameSessionWorker({
      attemptId: 'attempt-1',
      mode: mockMode('live'),
      content,
      attempt,
      projection: new PublicGameProjection({ attemptId: 'attempt-1', attempt }),
      platformGateway: gateway,
      resumeTokens: registry,
      disconnectDebounceMs: 10,
      reconnectGraceMs: 20,
      simulationStepMs: 50,
      maxCatchUpMs: 10_000,
      scheduler: runtime,
      clock: runtime,
      finishRetryDelaysMs: [100],
    });
    const attachment = value.attach('socket-1');

    attempt.signal('emergency-brake-used');
    value.synchronizeNow();
    await flush();

    expect(gateway.finishAttempts).toBe(1);
    expect(value.lifecycle).toBe('finishing');
    expect(registry.resolve(attachment.resumeToken, runtime.nowMs())).toBeNull();
    const terminalTime = attempt.time;

    runtime.advanceBy(99);
    expect(attempt.time).toBe(terminalTime);
    expect(value.lifecycle).toBe('finishing');
    expect(gateway.finishAttempts).toBe(1);

    runtime.advanceBy(1);
    await flush();
    expect(gateway.finishAttempts).toBe(2);
    expect(value.lifecycle).toBe('finished');
  });

  it('replays authoritative input records at their saved simulation times without finishing a platform result', () => {
    const runtime = new FakeRuntime();
    const attempt = new GameAttempt({ rootSeed: 77 });
    const content = new BaselineContentRegistry().resolve('vsm-baseline-01');
    const replayMode: SessionMode = {
      kind: 'replay',
      source: {
        simulationCompatibilityVersion: content.simulationCompatibilityVersion,
        gameLevelVersion: content.gameLevelVersion,
        rootSeed: '77',
        userInputs: [
          { at: 0, sequence: 0, command: { kind: 'take-journal' } },
          {
            at: 0,
            sequence: 1,
            command: {
              kind: 'edit-journal',
              value: {
                communication: 'ok',
                extinguisher: 'ok',
                climate: 'ok',
                emergencyBrake: 'ok',
                sanitation: 'clean',
                note: '',
                accepted: true,
              },
            },
          },
          { at: 0, sequence: 2, command: { kind: 'return-journal' } },
        ],
      },
      reveal: {
        traits: false,
        actionLogits: false,
        hiddenObjectState: false,
        assessment: false,
        explanations: false,
      },
    };
    const gateway = new MockPlatformGateway({
      attemptId: 'attempt-replay',
      gameLevelId: 'vsm-baseline-01',
      mode: replayMode,
    });
    const value = new GameSessionWorker({
      attemptId: 'attempt-replay',
      mode: replayMode,
      content,
      attempt,
      projection: new PublicGameProjection({
        attemptId: 'attempt-replay',
        attempt,
        mode: {
          kind: 'replay',
          capabilities: {
            seek: false,
            speeds: [1, 2, 4],
            entityInspection: false,
            revealTraits: false,
            revealActionScores: false,
            revealAssessment: false,
          },
        },
      }),
      platformGateway: gateway,
      resumeTokens: new InMemoryResumeTokenRegistry(),
      disconnectDebounceMs: 10,
      reconnectGraceMs: 20,
      simulationStepMs: 50,
      maxCatchUpMs: 10_000,
      scheduler: runtime,
      clock: runtime,
    });

    value.attach('socket-replay');
    value.projection.snapshot(value.publicClock());
    runtime.advanceBy(50);

    expect(attempt.snapshot().items.journal).toMatchObject({
      submitted: true,
      location: 'anchor',
    });
    expect(attempt.time).toBe(50_000);
    expect(value.projection.revision).toBe(3);
    expect(gateway.finished).toEqual([]);

    attempt.signal('emergency-brake-used');
    runtime.advanceBy(50);
    expect(value.publicClock().paused).toBe(true);
    expect(gateway.finished).toEqual([]);
  });

  it('records accepted input order together with authoritative simulation time', async () => {
    const runtime = new FakeRuntime();
    const attempt = new GameAttempt({ rootSeed: 21 });
    const { value, gateway } = worker(runtime, attempt, { maxCatchUpMs: 10_000 });
    value.attach('socket-1');

    runtime.advanceBy(100);
    value.synchronizeNow();
    value.recordUserInput({ kind: 'take-consumable', itemKind: 'drink' });
    runtime.advanceBy(50);
    value.synchronizeNow();
    value.recordUserInput({ kind: 'take-consumable', itemKind: 'food' });
    attempt.signal('emergency-brake-used');
    value.synchronizeNow();
    await flush();

    expect(gateway.finished).toHaveLength(1);
    expect(gateway.finished[0]?.userInputs).toEqual([
      {
        at: 100_000,
        sequence: 0,
        command: { kind: 'take-consumable', itemKind: 'drink' },
      },
      {
        at: 150_000,
        sequence: 1,
        command: { kind: 'take-consumable', itemKind: 'food' },
      },
    ]);
  });
});
