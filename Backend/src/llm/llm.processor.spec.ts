import type { Job } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import type { Clock } from '../common/clock';
import type { PrismaService } from '../prisma/prisma.service';
import type { RedisService } from '../redis/redis.service';
import type { RulesService } from '../rules/rules.service';
import { LlmProcessor, readJob } from './llm.processor';
import type { LlmProvider } from './provider';

const now = new Date('2026-09-27T03:00:00.000Z');

const graph = {
  id: 'ride-pressure',
  title: 'Свист',
  category: 'technical',
  stage: 'enroute',
  carClasses: ['ECONOMY'],
  difficulty: 1,
  competencies: ['safety'],
  init: { loyalty: 50, safety: 50 },
  llm: {
    enabled: true,
    mode: 'pool',
    keep: ['свист', 'тамбур'],
    forbid: ['medications', 'numbers', 'names', 'new-facts'],
    personas: ['тихо'],
  },
  start: 'open',
  nodes: {
    open: {
      text: 'Свист из тамбура.',
      choices: [
        { id: 'radio', text: 'Доложить по связи', next: 'end' },
        { id: 'walk', text: 'Самому дойти до свиста', next: 'end' },
      ],
    },
    end: { end: 'completed', text: 'Готово' },
  },
};

const validBody = JSON.stringify({
  text: 'Из тамбура слышен свист.',
  choices: [
    { id: 'radio', text: 'Сразу доложить по связи' },
    { id: 'walk', text: 'Сначала самому пройти на свист' },
  ],
});

function harness(autoApprove = true) {
  const prisma = {
    scenarioVersion: {
      findUnique: vi.fn().mockResolvedValue({ graph }),
    },
    scenarioTextVariant: {
      create: vi.fn().mockResolvedValue({ id: 'var-1' }),
    },
    gameSession: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  };
  const rules = { llm: () => ({ autoApprove, poolTarget: 8, maxUses: 25, liveTimeoutMs: 8000 }) };
  const provider: LlmProvider = {
    name: 'openai-compatible',
    complete: vi.fn().mockResolvedValue({ content: validBody, model: 'bonsai-2-27b' }),
  };
  const redis = {
    incr: vi.fn().mockResolvedValue(1),
    lpush: vi.fn().mockResolvedValue(1),
    ltrim: vi.fn().mockResolvedValue('OK'),
  };
  const clock: Clock = { now: () => now };
  const processor = new LlmProcessor(
    prisma as unknown as PrismaService,
    rules as unknown as RulesService,
    provider,
    redis as unknown as RedisService,
    clock,
  );
  return { processor, prisma, provider, redis };
}

function job(data: unknown): Job {
  return { data } as Job;
}

describe('readJob', () => {
  it('отбрасывает кривой payload', () => {
    expect(readJob(null)).toBeNull();
    expect(
      readJob({ scenarioId: 'a', version: 1, nodeId: 'n', persona: 'p', reason: 'nope' }),
    ).toBeNull();
  });
});

describe('LlmProcessor', () => {
  it('сохраняет валидный ответ как APPROVED', async () => {
    const { processor, prisma, provider } = harness(true);
    await processor.process(
      job({
        scenarioId: 'ride-pressure',
        version: 1,
        nodeId: 'open',
        persona: 'тихо',
        reason: 'manual',
      }),
    );
    expect(provider.complete).toHaveBeenCalledOnce();
    expect(prisma.scenarioTextVariant.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'APPROVED',
          model: 'bonsai-2-27b',
          promptVersion: '2026-09-27.1',
          maxUses: 25,
          nodeId: 'open',
        }),
      }),
    );
  });

  it('без autoApprove пишет PENDING_REVIEW', async () => {
    const { processor, prisma } = harness(false);
    await processor.process(
      job({
        scenarioId: 'ride-pressure',
        version: 1,
        nodeId: 'open',
        persona: 'тихо',
        reason: 'seed',
      }),
    );
    expect(prisma.scenarioTextVariant.create.mock.calls[0]?.[0].data.status).toBe('PENDING_REVIEW');
  });

  it('не сохраняет невалидный ответ и считает отказ', async () => {
    const { processor, prisma, provider, redis } = harness(true);
    provider.complete = vi
      .fn()
      .mockResolvedValue({ content: '{"text":"ok"}', model: 'bonsai-2-27b' });
    await processor.process(
      job({
        scenarioId: 'ride-pressure',
        version: 1,
        nodeId: 'open',
        persona: 'тихо',
        reason: 'manual',
      }),
    );
    expect(prisma.scenarioTextVariant.create).not.toHaveBeenCalled();
    expect(redis.incr).toHaveBeenCalledWith('llm:rejected');
    expect(redis.lpush).toHaveBeenCalledOnce();
  });

  it('ошибку провайдера пишет и пробрасывает на ретрай', async () => {
    const { processor, provider, redis } = harness(true);
    provider.complete = vi.fn().mockRejectedValue(new Error('LLM HTTP 503'));
    await expect(
      processor.process(
        job({
          scenarioId: 'ride-pressure',
          version: 1,
          nodeId: 'open',
          persona: 'тихо',
          reason: 'manual',
        }),
      ),
    ).rejects.toThrow(/503/);
    expect(redis.incr).not.toHaveBeenCalled();
    expect(redis.lpush).toHaveBeenCalledOnce();
  });

  it('live фиксирует вариант, пока узел не показан', async () => {
    const { processor, prisma } = harness(true);
    prisma.gameSession.findUnique.mockResolvedValue({
      state: { nodeId: 'other', journal: [] },
      textPlan: { open: null },
    });
    await processor.process(
      job({
        scenarioId: 'ride-pressure',
        version: 1,
        nodeId: 'open',
        persona: 'тихо',
        reason: 'live',
        sessionId: 'sess-1',
      }),
    );
    expect(prisma.gameSession.update).toHaveBeenCalledWith({
      where: { id: 'sess-1' },
      data: { textPlan: { open: 'var-1' } },
    });
  });

  it('не меняет текст узла, который уже на экране', async () => {
    const { processor, prisma } = harness(true);
    prisma.gameSession.findUnique.mockResolvedValue({
      state: { nodeId: 'open', journal: [] },
      textPlan: {},
    });
    await processor.process(
      job({
        scenarioId: 'ride-pressure',
        version: 1,
        nodeId: 'open',
        persona: 'тихо',
        reason: 'live',
        sessionId: 'sess-1',
      }),
    );
    expect(prisma.gameSession.update).not.toHaveBeenCalled();
  });
});
