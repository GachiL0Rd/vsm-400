import { ConflictException } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import type { Clock } from '../common/clock';
import type { AppConfig } from '../config/env';
import type { PrismaService } from '../prisma/prisma.service';
import type { RedisService } from '../redis/redis.service';
import type { RulesService } from '../rules/rules.service';
import {
  LLM_GEN_RETRY_KEY,
  LLM_JUDGE_RETRY_KEY,
  LLM_REJECTED_KEY,
  type LlmJobData,
} from './llm.constants';
import type { LlmProvider } from './provider';
import { VariantPoolService } from './variant-pool.service';

const graph = {
  id: 'ride-pressure',
  title: 'Свист',
  category: 'technical',
  stage: 'enroute',
  carClasses: ['ECONOMY'],
  difficulty: 1,
  competencies: ['safety'],
  init: { loyalty: 50, safety: 50 },
  llm: { enabled: true, mode: 'pool', personas: ['тихо', 'громко'] },
  start: 'open',
  nodes: {
    open: {
      text: 'Свист',
      choices: [{ id: 'a', text: 'Доложить', next: 'end' }],
    },
    end: { end: 'completed', text: 'Готово' },
  },
};

function harness(name: LlmProvider['name'] = 'openai-compatible') {
  const prisma = {
    scenario: { findMany: vi.fn(), findUnique: vi.fn() },
    scenarioVersion: { findUnique: vi.fn() },
    scenarioTextVariant: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      groupBy: vi.fn(),
    },
    gameSession: { findUnique: vi.fn(), update: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };
  const rules = {
    llm: () => ({ autoApprove: true, poolTarget: 2, maxUses: 3, liveTimeoutMs: 8000 }),
  };
  const redis = { get: vi.fn(), lrange: vi.fn() };
  const clock: Clock = { now: () => new Date('2026-09-27T03:00:00.000Z') };
  const provider: LlmProvider = { name, complete: vi.fn() };
  const queue = {
    add: vi.fn().mockResolvedValue(undefined),
    getJobs: vi.fn().mockResolvedValue([]),
    getJobCounts: vi.fn(),
  };
  const pool = new VariantPoolService(
    prisma as unknown as PrismaService,
    rules as unknown as RulesService,
    redis as unknown as RedisService,
    clock,
    { llmModel: 'bonsai-2-27b' } as AppConfig,
    provider,
    queue as unknown as Queue<LlmJobData>,
  );
  return { pool, prisma, queue, provider, redis };
}

describe('VariantPoolService', () => {
  it('pick берёт только APPROVED и один раз дёргает rng', async () => {
    const { pool, prisma } = harness();
    prisma.scenarioTextVariant.findMany.mockResolvedValue([]);
    await expect(
      pool.pick('ride-pressure', 1, 'open', { pick: (items) => items[0] as never }),
    ).resolves.toBeNull();

    const rows = [
      { id: 'a', payload: { text: 'один', choices: [] } },
      { id: 'b', payload: { text: 'два', choices: [] } },
    ];
    prisma.scenarioTextVariant.findMany.mockResolvedValue(rows);
    const pick = <T>(items: readonly T[]): T => {
      const chosen = items[1];
      if (chosen === undefined) {
        throw new Error('пустой список');
      }
      return chosen;
    };
    await expect(pool.pick('ride-pressure', 1, 'open', { pick })).resolves.toEqual({
      id: 'b',
      payload: { text: 'два', choices: [] },
    });
    expect(prisma.scenarioTextVariant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'APPROVED', sessionId: null }),
      }),
    );
  });

  it('pick общей выдачи не берёт вариант, привязанный к сессии, и фильтрует персону', async () => {
    const { pool, prisma } = harness();
    prisma.scenarioTextVariant.findMany.mockResolvedValue([]);
    await pool.pick(
      'ride-pressure',
      1,
      'open',
      { pick: (items) => items[0] as never },
      {
        persona: 'тихо',
      },
    );
    expect(prisma.scenarioTextVariant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          scenarioId: 'ride-pressure',
          version: 1,
          nodeId: 'open',
          status: 'APPROVED',
          sessionId: null,
          persona: 'тихо',
        },
      }),
    );
  });

  it('на maxUses уводит в RETIRED и ставит refill', async () => {
    const { pool, prisma, queue } = harness();
    prisma.scenarioTextVariant.update.mockResolvedValue({
      id: 'var-1',
      scenarioId: 'ride-pressure',
      version: 2,
      nodeId: 'open',
      persona: 'тихо',
      status: 'APPROVED',
      uses: 3,
      maxUses: 3,
    });
    prisma.scenarioTextVariant.updateMany.mockResolvedValue({ count: 1 });
    await pool.markUsed(['var-1']);
    expect(prisma.scenarioTextVariant.updateMany).toHaveBeenCalledWith({
      where: { id: 'var-1', status: 'APPROVED' },
      data: { status: 'RETIRED' },
    });
    expect(queue.add).toHaveBeenCalledWith(
      'generate',
      expect.objectContaining({ reason: 'refill', nodeId: 'open', persona: 'тихо' }),
      { priority: 10 },
    );
  });

  it('не ставит второй refill, если вариант уже сняли', async () => {
    const { pool, prisma, queue } = harness();
    prisma.scenarioTextVariant.update.mockResolvedValue({
      id: 'var-1',
      status: 'APPROVED',
      uses: 3,
      maxUses: 3,
      scenarioId: 'ride-pressure',
      version: 1,
      nodeId: 'open',
      persona: 'тихо',
    });
    prisma.scenarioTextVariant.updateMany.mockResolvedValue({ count: 0 });
    await pool.markUsed(['var-1']);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('ниже порога только увеличивает uses', async () => {
    const { pool, prisma, queue } = harness();
    prisma.scenarioTextVariant.update.mockResolvedValue({
      status: 'APPROVED',
      uses: 1,
      maxUses: 3,
    });
    await pool.markUsed(['var-1']);
    expect(prisma.scenarioTextVariant.updateMany).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('none не ходит в базу за пулом и не ставит live', async () => {
    const { pool, prisma } = harness('none');
    await pool.ensurePool();
    expect(prisma.scenario.findMany).not.toHaveBeenCalled();
    await expect(
      pool.enqueueLive('sess', [{ scenarioId: 'a', version: 1, nodeId: 'n' }], 'тихо'),
    ).resolves.toBe(0);
    await expect(pool.generate('ride-pressure', 'open', 1)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('добирает APPROVED до poolTarget с учётом очереди', async () => {
    const { pool, prisma, queue } = harness();
    prisma.scenario.findMany.mockResolvedValue([{ id: 'ride-pressure', currentVersion: 4 }]);
    prisma.scenarioVersion.findUnique.mockResolvedValue({ graph });
    prisma.scenarioTextVariant.count.mockResolvedValue(1);
    queue.getJobs.mockResolvedValue([
      { data: { scenarioId: 'ride-pressure', version: 4, nodeId: 'open' } },
    ]);
    await pool.ensurePool();
    expect(queue.add).not.toHaveBeenCalled();

    prisma.scenarioTextVariant.count.mockResolvedValue(0);
    queue.getJobs.mockResolvedValue([]);
    await pool.ensurePool();
    expect(queue.add).toHaveBeenCalledTimes(2);
    expect(queue.add.mock.calls[0]?.[1]).toMatchObject({ reason: 'seed', persona: 'тихо' });
    expect(queue.add.mock.calls[1]?.[1]).toMatchObject({ persona: 'громко' });
    expect(queue.add.mock.calls[0]?.[2]).toEqual({ priority: 10 });
  });

  it('live важнее ручной генерации', async () => {
    const { pool, queue } = harness();
    await pool.enqueueLive(
      'sess-1',
      [{ scenarioId: 'ride-pressure', version: 1, nodeId: 'open' }],
      'тихо',
    );
    expect(queue.add).toHaveBeenCalledWith(
      'generate',
      expect.objectContaining({ reason: 'live', sessionId: 'sess-1' }),
      { priority: 1 },
    );
  });

  it('releaseSession снимает sessionId только у APPROVED', async () => {
    const { pool, prisma } = harness();
    prisma.scenarioTextVariant.updateMany.mockResolvedValue({ count: 1 });
    await expect(pool.releaseSession('sess-1')).resolves.toBe(1);
    expect(prisma.scenarioTextVariant.updateMany).toHaveBeenCalledWith({
      where: { sessionId: 'sess-1', status: 'APPROVED' },
      data: { sessionId: null },
    });
  });

  it('bindLive берёт вариант своей сессии и не спрашивает чужую персону', async () => {
    const { pool, prisma } = harness();
    prisma.gameSession.findUnique.mockResolvedValue({
      textPlan: { 'ride-pressure:open': null },
    });
    prisma.scenarioTextVariant.findFirst.mockResolvedValue({ id: 'session-var' });
    prisma.scenarioTextVariant.update.mockResolvedValue({
      id: 'session-var',
      scenarioId: 'ride-pressure',
      version: 1,
      nodeId: 'open',
      persona: 'тихо',
      status: 'APPROVED',
      uses: 1,
      maxUses: 25,
    });
    const plan = await pool.bindLive({
      sessionId: 'sess-1',
      scenarioId: 'ride-pressure',
      version: 1,
      nodeId: 'open',
    });
    expect(prisma.scenarioTextVariant.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          sessionId: 'sess-1',
          scenarioId: 'ride-pressure',
          version: 1,
          nodeId: 'open',
          status: 'APPROVED',
        },
      }),
    );
    const where = prisma.scenarioTextVariant.findFirst.mock.calls[0]?.[0].where as {
      persona?: string;
    };
    expect(where.persona).toBeUndefined();
    expect(plan?.nodes['ride-pressure:open']).toBe('session-var');
    expect(plan?.shown).toContain('ride-pressure:open');
    expect(prisma.scenarioTextVariant.update).toHaveBeenCalled();
  });

  it('bindLive без варианта сессии замораживает YAML и не тратит чужой пул', async () => {
    const { pool, prisma } = harness();
    prisma.gameSession.findUnique.mockResolvedValue({
      textPlan: { 'ride-pressure:open': null },
    });
    prisma.scenarioTextVariant.findFirst.mockResolvedValue(null);
    const plan = await pool.bindLive({
      sessionId: 'sess-1',
      scenarioId: 'ride-pressure',
      version: 1,
      nodeId: 'open',
    });
    expect(plan?.nodes['ride-pressure:open']).toBeNull();
    expect(plan?.shown).toEqual(['ride-pressure:open']);
    expect(prisma.scenarioTextVariant.update).not.toHaveBeenCalled();
  });

  it('статус отдаёт счётчики повторов генерации и судьи', async () => {
    const { pool, prisma, queue, redis } = harness();
    queue.getJobCounts.mockResolvedValue({ waiting: 0, active: 0, failed: 0, delayed: 0 });
    redis.get.mockImplementation(async (key: string) => {
      if (key === LLM_REJECTED_KEY) {
        return '3';
      }
      if (key === LLM_GEN_RETRY_KEY) {
        return '2';
      }
      if (key === LLM_JUDGE_RETRY_KEY) {
        return '5';
      }
      return null;
    });
    redis.lrange.mockResolvedValue([]);
    prisma.scenarioTextVariant.groupBy.mockResolvedValue([]);
    await expect(pool.status()).resolves.toMatchObject({
      rejected: 3,
      retries: { generation: 2, judge: 5 },
    });
  });
});
