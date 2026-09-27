import { describe, expect, it, vi } from 'vitest';
import type { RunCompletedPayload } from '../common/events';
import { LlmSessionListener } from './llm-session.listener';
import type { VariantPoolService } from './variant-pool.service';

describe('LlmSessionListener', () => {
  it('ставит live-задачу на каждый узел с персоной из события', async () => {
    const pool = {
      enqueueLive: vi.fn().mockResolvedValue(1),
      releaseSession: vi.fn().mockResolvedValue(0),
    };
    const listener = new LlmSessionListener(pool as unknown as VariantPoolService);
    await listener.onTextRequested({
      sessionId: 'sess-1',
      items: [
        { scenarioId: 'ride-pressure', version: 2, nodeId: 'open', persona: 'тихо' },
        { scenarioId: 'ride-unwell', version: 1, nodeId: 'risk', persona: 'злой' },
      ],
    });
    expect(pool.enqueueLive).toHaveBeenNthCalledWith(
      1,
      'sess-1',
      [{ scenarioId: 'ride-pressure', version: 2, nodeId: 'open' }],
      'тихо',
    );
    expect(pool.enqueueLive).toHaveBeenNthCalledWith(
      2,
      'sess-1',
      [{ scenarioId: 'ride-unwell', version: 1, nodeId: 'risk' }],
      'злой',
    );
  });

  it('после рейса отпускает в пул только через releaseSession', async () => {
    const pool = {
      enqueueLive: vi.fn(),
      releaseSession: vi.fn().mockResolvedValue(2),
    };
    const listener = new LlmSessionListener(pool as unknown as VariantPoolService);
    await listener.onRunCompleted({ sessionId: 'sess-9' } as RunCompletedPayload);
    expect(pool.releaseSession).toHaveBeenCalledWith('sess-9');
  });
});
