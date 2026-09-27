import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import type { Clock } from '../common/clock';
import type { AppConfig } from '../config/env';
import type { PrismaService } from '../prisma/prisma.service';
import type { RedisService } from '../redis/redis.service';
import type { RulesService } from '../rules/rules.service';
import { LlmProcessor, readJob } from './llm.processor';
import { PROMPT_VERSION, SCHEMA_NAME } from './prompt';
import type { LlmCompleteInput, LlmProvider } from './provider';
import type { VariantPoolService } from './variant-pool.service';

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

const judgeOk = ['ситуация: да', 'radio: да', 'walk: да'].join('\n');

const judgeDrift = [
  'ситуация: нет — таблетка стала пилкой',
  'radio: да',
  'walk: нет — действие другое',
].join('\n');

function harness(autoApprove = true, llmJudge = true, judge?: LlmProvider) {
  const prisma = {
    scenarioVersion: {
      findUnique: vi.fn().mockResolvedValue({ graph }),
    },
    scenarioTextVariant: {
      create: vi.fn().mockResolvedValue({ id: 'var-1' }),
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
  const rules = {
    llm: () => ({
      autoApprove,
      poolTarget: 8,
      maxUses: 25,
      liveTimeoutMs: 8000,
      maxSimilarity: 0.75,
    }),
  };
  const provider: LlmProvider = {
    name: 'openai-compatible',
    complete: vi.fn(async (input: LlmCompleteInput) => {
      if (input.temperature === 0) {
        return { content: judgeOk, model: 'qwen3-8b' };
      }
      return { content: validBody, model: 'qwen3-8b' };
    }),
  };
  const redis = {
    incr: vi.fn().mockResolvedValue(1),
    lpush: vi.fn().mockResolvedValue(1),
    ltrim: vi.fn().mockResolvedValue('OK'),
  };
  const clock: Clock = { now: () => now };
  const pool = { bindLive: vi.fn().mockResolvedValue(null) };
  const processor = new LlmProcessor(
    prisma as unknown as PrismaService,
    rules as unknown as RulesService,
    provider,
    judge ?? provider,
    redis as unknown as RedisService,
    clock,
    { llmJudge } as AppConfig,
    pool as unknown as VariantPoolService,
  );
  return { processor, prisma, provider, redis, pool };
}

function job(data: unknown): Job {
  return { data } as Job;
}

const manual = {
  scenarioId: 'ride-pressure',
  version: 1,
  nodeId: 'open',
  persona: 'тихо',
  reason: 'manual' as const,
};

describe('readJob', () => {
  it('отбрасывает кривой payload', () => {
    expect(readJob(null)).toBeNull();
    expect(
      readJob({ scenarioId: 'a', version: 1, nodeId: 'n', persona: 'p', reason: 'nope' }),
    ).toBeNull();
  });
});

describe('LlmProcessor', () => {
  it('судья прошёл и autoApprove — APPROVED, персона из задачи', async () => {
    const { processor, prisma, provider } = harness(true, true);
    prisma.scenarioTextVariant.findMany.mockResolvedValue([
      {
        id: 'old-same',
        persona: 'тихо',
        payload: {
          text: 'Старая реплика про тамбур.',
          choices: [
            { id: 'radio', text: 'Прежняя связь' },
            { id: 'walk', text: 'Прежний путь' },
          ],
        },
      },
      {
        id: 'old-other',
        persona: 'громко',
        payload: {
          text: 'Чужая персона орёт в тамбуре.',
          choices: [
            { id: 'radio', text: 'Чужой доклад' },
            { id: 'walk', text: 'Чужой проход' },
          ],
        },
      },
    ]);
    await processor.process(job({ ...manual, persona: 'звонко' }));
    expect(provider.complete).toHaveBeenCalledTimes(2);
    const first = vi.mocked(provider.complete).mock.calls[0]?.[0];
    expect(first?.schemaName).toBe(SCHEMA_NAME);
    expect(first?.messages[1]?.content).toContain('Персона пассажира: звонко');
    expect(first?.messages[1]?.content).toContain('Не повторяй эти формулировки:');
    expect(first?.messages[1]?.content).toContain('Старая реплика про тамбур.');
    const second = vi.mocked(provider.complete).mock.calls[1]?.[0];
    expect(second?.jsonSchema).toBeUndefined();
    expect(second?.schemaName).toBeUndefined();
    expect(second?.temperature).toBe(0);
    expect(second?.messages[0]?.content).toContain('Ровно одна строка на пункт');
    expect(second?.messages[1]?.content).toContain('ситуация');
    expect(prisma.scenarioTextVariant.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'APPROVED',
          model: 'qwen3-8b',
          promptVersion: PROMPT_VERSION,
          maxUses: 25,
          nodeId: 'open',
          persona: 'звонко',
          reason: 'MANUAL',
          sessionId: null,
          rejectReason: null,
        }),
      }),
    );
  });

  it('генерация и судья ходят в разные провайдеры', async () => {
    const judge: LlmProvider = {
      name: 'gigachat',
      complete: vi.fn(async () => ({ content: judgeOk, model: 'GigaChat-2-Max' })),
    };
    const { processor, provider, prisma } = harness(true, true, judge);
    await processor.process(job(manual));
    expect(provider.complete).toHaveBeenCalledOnce();
    expect(judge.complete).toHaveBeenCalledOnce();
    expect(vi.mocked(judge.complete).mock.calls[0]?.[0]?.temperature).toBe(0);
    expect(vi.mocked(judge.complete).mock.calls[0]?.[0]?.jsonSchema).toBeUndefined();
    expect(prisma.scenarioTextVariant.create.mock.calls[0]?.[0].data.model).toBe('qwen3-8b');
  });

  it('без судьи autoApprove не одобряет', async () => {
    const { processor, prisma, provider } = harness(true, false);
    await processor.process(job(manual));
    expect(provider.complete).toHaveBeenCalledOnce();
    expect(prisma.scenarioTextVariant.create.mock.calls[0]?.[0].data.status).toBe('PENDING_REVIEW');
  });

  it('судья прошёл, но autoApprove выключен — PENDING_REVIEW', async () => {
    const { processor, prisma } = harness(false, true);
    await processor.process(job(manual));
    expect(prisma.scenarioTextVariant.create.mock.calls[0]?.[0].data.status).toBe('PENDING_REVIEW');
  });

  it('судья видит подмену смысла и пишет REJECTED', async () => {
    const { processor, prisma, provider, redis, pool } = harness(true, true);
    provider.complete = vi.fn(async (input: LlmCompleteInput) => {
      if (input.temperature === 0) {
        return { content: judgeDrift, model: 'qwen3-8b' };
      }
      return { content: validBody, model: 'qwen3-8b' };
    });
    await processor.process(job({ ...manual, reason: 'live', sessionId: 'sess-1' }));
    expect(provider.complete).toHaveBeenCalledTimes(2);
    expect(prisma.scenarioTextVariant.create.mock.calls[0]?.[0].data).toMatchObject({
      status: 'REJECTED',
      reason: 'LIVE',
      sessionId: 'sess-1',
      rejectReason: 'judge: ситуация: таблетка стала пилкой; judge: walk: действие другое',
    });
    expect(redis.incr).toHaveBeenCalledWith('llm:rejected');
    expect(pool.bindLive).not.toHaveBeenCalled();
  });

  it('пустой ответ судьи ретраится один раз и потом проходит', async () => {
    const debug = vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    const { processor, prisma, provider } = harness(true, true);
    const replies = ['', judgeOk];
    provider.complete = vi.fn(async (input: LlmCompleteInput) => {
      if (input.temperature === 0) {
        return { content: replies.shift() ?? '', model: 'qwen3-8b' };
      }
      return { content: validBody, model: 'qwen3-8b' };
    });
    await processor.process(job(manual));
    expect(provider.complete).toHaveBeenCalledTimes(3);
    const reminder = vi.mocked(provider.complete).mock.calls[2]?.[0];
    expect(reminder?.temperature).toBe(0);
    expect(reminder?.jsonSchema).toBeUndefined();
    expect(reminder?.messages[1]?.content).toContain('Прошлый ответ не разобран.');
    expect(prisma.scenarioTextVariant.create.mock.calls[0]?.[0].data.status).toBe('APPROVED');
    expect(debug.mock.calls.some((call) => String(call[0]).includes('ситуация: да'))).toBe(true);
    debug.mockRestore();
  });

  it('второй кривой ответ — judge-unparsed, сырой текст не в базе', async () => {
    const { processor, prisma, provider, redis } = harness(true, true);
    provider.complete = vi.fn(async (input: LlmCompleteInput) => {
      if (input.temperature === 0) {
        return { content: 'не строка судьи, а болтовня', model: 'qwen3-8b' };
      }
      return { content: validBody, model: 'qwen3-8b' };
    });
    await processor.process(job(manual));
    expect(provider.complete).toHaveBeenCalledTimes(3);
    expect(prisma.scenarioTextVariant.create.mock.calls[0]?.[0].data).toMatchObject({
      status: 'REJECTED',
      rejectReason: 'judge-unparsed',
    });
    const stored = JSON.stringify(prisma.scenarioTextVariant.create.mock.calls[0]?.[0]);
    expect(stored).not.toContain('болтовня');
    const pushed = String(redis.lpush.mock.calls[0]?.[1]);
    expect(pushed).toContain('judge-unparsed');
    expect(pushed).not.toContain('болтовня');
  });

  it('слишком похожий текст не доходит до судьи', async () => {
    const { processor, prisma, provider, redis } = harness(true, true);
    prisma.scenarioTextVariant.findMany.mockResolvedValue([
      {
        id: 'copy-1',
        persona: 'тихо',
        payload: JSON.parse(validBody) as unknown,
      },
    ]);
    await processor.process(job(manual));
    expect(provider.complete).toHaveBeenCalledOnce();
    expect(prisma.scenarioTextVariant.create.mock.calls[0]?.[0].data).toMatchObject({
      status: 'REJECTED',
    });
    expect(prisma.scenarioTextVariant.create.mock.calls[0]?.[0].data.rejectReason).toContain(
      'copy-1',
    );
    expect(redis.incr).toHaveBeenCalledWith('llm:rejected');
  });

  it('не сохраняет невалидный ответ и считает отказ', async () => {
    const { processor, prisma, provider, redis } = harness(true);
    provider.complete = vi.fn().mockResolvedValue({ content: '{"text":"ok"}', model: 'qwen3-8b' });
    await processor.process(job(manual));
    expect(prisma.scenarioTextVariant.create).not.toHaveBeenCalled();
    expect(redis.incr).toHaveBeenCalledWith('llm:rejected');
    expect(redis.lpush).toHaveBeenCalledOnce();
  });

  it('ошибку провайдера пишет и пробрасывает на ретрай', async () => {
    const { processor, provider, redis } = harness(true);
    provider.complete = vi.fn().mockRejectedValue(new Error('LLM HTTP 503'));
    await expect(processor.process(job(manual))).rejects.toThrow(/503/);
    expect(redis.incr).not.toHaveBeenCalled();
    expect(redis.lpush).toHaveBeenCalledOnce();
  });

  it('live APPROVED закрепляет вариант сессии', async () => {
    const { processor, pool } = harness(true);
    await processor.process(
      job({
        ...manual,
        reason: 'live',
        sessionId: 'sess-1',
      }),
    );
    expect(pool.bindLive).toHaveBeenCalledWith({
      sessionId: 'sess-1',
      scenarioId: 'ride-pressure',
      version: 1,
      nodeId: 'open',
    });
  });
});
