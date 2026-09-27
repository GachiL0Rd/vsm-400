import { describe, expect, it } from 'vitest';
import { HttpPlatformGateway, MockPlatformGateway, mockMode } from './platform-gateway.ts';
import type { PlatformGatewayError } from './types.ts';

describe('platform gateways', () => {
  it('maps platform HTTP DTOs to server-domain values', async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    const gateway = new HttpPlatformGateway({
      baseUrl: 'https://platform.test/',
      serviceToken: 'service-token',
      timeoutMs: 100,
      fetch: async (url, init) => {
        requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
        return new Response(
          JSON.stringify({
            contractVersion: 1,
            attemptId: 'a-1',
            gameLevelId: 'vsm-baseline-01',
            mode: { kind: 'live' },
          }),
        );
      },
    });

    await expect(gateway.resolveSession('opaque-key')).resolves.toEqual({
      attemptId: 'a-1',
      gameLevelId: 'vsm-baseline-01',
      mode: { kind: 'live' },
    });
    expect(requests).toEqual([
      { url: 'https://platform.test/api/game/sessions/resolve', body: { key: 'opaque-key' } },
    ]);
  });

  it('maps an aborted platform request to a timeout error', async () => {
    const gateway = new HttpPlatformGateway({
      baseUrl: 'https://platform.test/',
      serviceToken: 'service-token',
      timeoutMs: 1,
      fetch: async (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    });

    await expect(gateway.resolveSession('opaque-key')).rejects.toMatchObject<
      Partial<PlatformGatewayError>
    >({ kind: 'timeout' });
  });

  it('makes mock finalization idempotent by attempt ID', async () => {
    const gateway = new MockPlatformGateway({
      attemptId: 'a-1',
      gameLevelId: 'vsm-baseline-01',
      mode: mockMode('live'),
    });
    const result = {
      attemptId: 'a-1',
      content: {
        gameLevelId: 'vsm-baseline-01',
        gameLevelVersion: '1',
        simulationCompatibilityVersion: '1',
      },
      rootSeed: '1',
      userInputs: [],
      achievements: { setVersion: '1', ids: [] },
      termination: { kind: 'route-completed' as const, outcomeId: 'route-completed' },
      scores: { safety: 0, customerSatisfaction: 0 },
    };
    await gateway.finishSession(result);
    await gateway.finishSession(result);
    expect(gateway.finished).toHaveLength(1);
  });
});
