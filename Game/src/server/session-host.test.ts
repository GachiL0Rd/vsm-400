import { describe, expect, it } from 'vitest';
import { BaselineContentRegistry } from './content-registry.ts';
import { MockPlatformGateway, mockMode } from './platform-gateway.ts';
import { InMemoryResumeTokenRegistry } from './resume-token-registry.ts';
import { GameSessionHost } from './session-host.ts';
import type {
  FinishedGameResult,
  FinishSessionResponse,
  PlatformGateway,
  ResolvedPlatformSession,
} from './types.ts';

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

class MutablePlatformGateway implements PlatformGateway {
  constructor(public resolved: ResolvedPlatformSession) {}

  async resolveSession(): Promise<ResolvedPlatformSession> {
    return this.resolved;
  }

  async finishSession(_result: FinishedGameResult): Promise<FinishSessionResponse> {
    return { resultId: 'result-1', redirectUrl: 'http://localhost/results/attempt-1' };
  }
}

describe('GameSessionHost', () => {
  it('releases a worker after its terminal result is persisted', async () => {
    const host = new GameSessionHost({
      platformGateway: new MockPlatformGateway({
        attemptId: 'attempt-1',
        gameLevelId: 'vsm-baseline-01',
        mode: mockMode('live'),
      }),
      contentRegistry: new BaselineContentRegistry(),
      resumeTokens: new InMemoryResumeTokenRegistry(),
      disconnectDebounceMs: 1_000,
      reconnectGraceMs: 30_000,
      simulationStepMs: 60_000,
    });

    await host.attachWithSessionKey('session-key', 'connection-1');
    const worker = host.worker('attempt-1');
    if (worker === undefined) throw new Error('Expected hosted worker');

    worker.projection.attempt.signal('emergency-brake-used');
    await worker.finish();
    await flush();

    expect(worker.lifecycle).toBe('finished');
    expect(host.worker('attempt-1')).toBeUndefined();
    host.shutdown();
  });

  it('rejects conflicting launch data for an already hosted attempt', async () => {
    const platform = new MutablePlatformGateway({
      attemptId: 'attempt-1',
      gameLevelId: 'vsm-baseline-01',
      mode: mockMode('live'),
    });
    const host = new GameSessionHost({
      platformGateway: platform,
      contentRegistry: new BaselineContentRegistry(),
      resumeTokens: new InMemoryResumeTokenRegistry(),
      disconnectDebounceMs: 1_000,
      reconnectGraceMs: 30_000,
      simulationStepMs: 60_000,
    });

    await host.attachWithSessionKey('session-key', 'connection-1');
    platform.resolved = {
      attemptId: 'attempt-1',
      gameLevelId: 'vsm-baseline-01',
      mode: mockMode('guided'),
    };

    await expect(host.attachWithSessionKey('session-key-2', 'connection-2')).rejects.toThrow(
      /conflicting launch data/,
    );
    expect(host.worker('attempt-1')?.lifecycle).toBe('active');
    host.shutdown();
  });
});
