import { describe, expect, it } from 'vitest';
import { PublicGameProjection } from '../projection/public-game-session.ts';
import { GameAttempt } from '../simulation/game-attempt.ts';
import { BaselineContentRegistry } from './content-registry.ts';
import {
  GameSessionWorker,
  type WorkerScheduler,
  type WorkerTimer,
} from './game-session-worker.ts';
import { MockPlatformGateway, mockMode } from './platform-gateway.ts';
import { InMemoryResumeTokenRegistry } from './resume-token-registry.ts';

class FakeScheduler implements WorkerScheduler {
  private now = 0;
  private readonly tasks: Array<{ at: number; active: boolean; callback: () => void }> = [];

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

function worker(scheduler: FakeScheduler, attempt = new GameAttempt({ rootSeed: 5 })) {
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
      reconnectGraceMs: 20,
      scheduler,
      clock: { nowMs: () => 0 },
    }),
  };
}

describe('GameSessionWorker', () => {
  it('keeps a resume token reusable only for its bound attempt before expiry', () => {
    const registry = new InMemoryResumeTokenRegistry();
    const token = registry.issue('attempt-1', 10);

    expect(registry.validate(token, 'attempt-1', 10)).toBe(true);
    expect(registry.resolve(token, 10)).toBe('attempt-1');
    expect(registry.validate(token, 'attempt-1', 10)).toBe(true);
    expect(registry.validate(token, 'another-attempt', 10)).toBe(false);
    expect(registry.validate(token, 'attempt-1', 11)).toBe(false);
    expect(registry.resolve(token, 11)).toBeNull();
  });

  it('pauses only after disconnect debounce and resumes before grace expires', () => {
    const scheduler = new FakeScheduler();
    const { value } = worker(scheduler);

    value.attach('socket-1');
    value.detach('socket-1');
    scheduler.advanceBy(9);
    expect(value.lifecycle).toBe('active');

    scheduler.advanceBy(1);
    expect(value.lifecycle).toBe('paused');
    expect(value.connectionLifecycle).toBe('detached');

    value.attach('socket-2');
    expect(value.lifecycle).toBe('active');
    expect(value.connectionLifecycle).toBe('attached');
  });

  it('aborts after the reconnect grace period and revokes resume tokens', () => {
    const scheduler = new FakeScheduler();
    const { value, registry } = worker(scheduler);
    const attachment = value.attach('socket-1');
    value.detach('socket-1');

    scheduler.advanceBy(30);
    expect(value.lifecycle).toBe('aborted');
    expect(registry.validate(attachment.resumeToken, 'attempt-1', 0)).toBe(false);
  });

  it('finalizes a terminal attempt exactly once', async () => {
    const scheduler = new FakeScheduler();
    const attempt = new GameAttempt({ rootSeed: 12 });
    attempt.advanceTo(attempt.scenario.normalEndTimeUs);
    const { value, gateway } = worker(scheduler, attempt);
    value.attach('socket-1');

    const [first, second] = await Promise.all([value.finish(), value.finish()]);
    expect(first).toEqual(second);
    expect(value.lifecycle).toBe('finished');
    expect(gateway.finished).toHaveLength(1);
    expect(gateway.finished[0]?.rootSeed).toBe('12');
  });
});
