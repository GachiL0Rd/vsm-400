import { ConflictException } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import type { Clock } from '../common/clock';
import type { AppConfig } from '../config/env';
import type { PrismaService } from '../prisma/prisma.service';
import type { RedisService } from '../redis/redis.service';
import type { RulesService } from '../rules/rules.service';
import type { LlmJobData } from './llm.constants';
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
      count: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      groupBy: vi.fn(),
    },
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
  return { pool, prisma, queue, provider };
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
      expect.objectContaining({ where: expect.objectContaining({ status: 'APPROVED' }) }),
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
});
