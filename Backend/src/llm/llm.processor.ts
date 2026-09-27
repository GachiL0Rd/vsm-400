import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { Clock } from '../common/clock';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { RulesService } from '../rules/rules.service';
import {
  LLM_ERROR_LIMIT,
  LLM_ERRORS_KEY,
  LLM_PROVIDER,
  LLM_QUEUE,
  LLM_RATE_MAX,
  LLM_RATE_WINDOW_MS,
  LLM_REJECTED_KEY,
  LLM_WORKER_CONCURRENCY,
  type LlmJobData,
  type LlmJobReason,
} from './llm.constants';
import { buildMessages, PROMPT_VERSION, SCHEMA_NAME, variantJsonSchema } from './prompt';
import type { LlmProvider } from './provider';
import { bundleText, decisionNodes, parseStoredGraph, sourceOf } from './scenario-nodes';
import { applicableKeep } from './text-norm';
import { type VariantPayload, validateVariant } from './validate-variant';

@Processor(LLM_QUEUE, {
  concurrency: LLM_WORKER_CONCURRENCY,
  limiter: { max: LLM_RATE_MAX, duration: LLM_RATE_WINDOW_MS },
})
@Injectable()
export class LlmProcessor extends WorkerHost {
  private readonly logger = new Logger(LlmProcessor.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RulesService) private readonly rules: RulesService,
    @Inject(LLM_PROVIDER) private readonly provider: LlmProvider,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(Clock) private readonly clock: Clock,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    const data = readJob(job.data);
    if (!data || this.provider.name === 'none') {
      return;
    }
    const loaded = await this.loadNode(data);
    if (!loaded) {
      return;
    }
    let generated: { content: string; model: string };
    try {
      generated = await this.generate(data, loaded);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.note(data, message, false);
      throw error;
    }
    const verdict = validateVariant(generated.content, {
      ...loaded.source,
      keep: loaded.keep,
    });
    if (!verdict.ok) {
      await this.note(data, verdict.reasons.join('; '), true);
      return;
    }
    const saved = await this.save(data, generated.model, verdict.payload);
    if (data.reason === 'live' && data.sessionId) {
      await this.pin(data.sessionId, data.nodeId, saved.id);
    }
  }

  private async loadNode(data: LlmJobData): Promise<{
    source: ReturnType<typeof sourceOf>;
    keep: string[];
    forbid: string[];
  } | null> {
    const stored = await this.prisma.scenarioVersion.findUnique({
      where: { scenarioId_version: { scenarioId: data.scenarioId, version: data.version } },
    });
    const graph = stored ? parseStoredGraph(stored.graph) : null;
    if (!graph?.llm?.enabled) {
      return null;
    }
    const found = decisionNodes(graph).find((item) => item.id === data.nodeId);
    if (!found) {
      return null;
    }
    const source = sourceOf(found.node);
    return {
      source,
      keep: applicableKeep(graph.llm.keep ?? [], bundleText(source)),
      forbid: graph.llm.forbid ?? [],
    };
  }

  private async generate(
    data: LlmJobData,
    loaded: { source: ReturnType<typeof sourceOf>; keep: string[]; forbid: string[] },
  ): Promise<{ content: string; model: string }> {
    return this.provider.complete({
      messages: buildMessages({
        persona: data.persona,
        keep: loaded.keep,
        forbid: loaded.forbid,
        text: loaded.source.text,
        choices: loaded.source.choices,
      }),
      jsonSchema: variantJsonSchema(loaded.source.choices.map((choice) => choice.id)),
      schemaName: SCHEMA_NAME,
    });
  }

  private async save(
    data: LlmJobData,
    model: string,
    payload: VariantPayload,
  ): Promise<{ id: string }> {
    const rules = this.rules.llm();
    return this.prisma.scenarioTextVariant.create({
      data: {
        scenarioId: data.scenarioId,
        version: data.version,
        nodeId: data.nodeId,
        persona: data.persona,
        promptVersion: PROMPT_VERSION,
        model,
        payload: payload as Prisma.InputJsonValue,
        status: rules.autoApprove ? 'APPROVED' : 'PENDING_REVIEW',
        maxUses: rules.maxUses,
      },
      select: { id: true },
    });
  }

  private async pin(sessionId: string, nodeId: string, variantId: string): Promise<void> {
    const session = await this.prisma.gameSession.findUnique({ where: { id: sessionId } });
    if (!session || nodeShown(session.state, nodeId)) {
      return;
    }
    const plan = readPlan(session.textPlan);
    if (typeof plan[nodeId] === 'string') {
      return;
    }
    plan[nodeId] = variantId;
    await this.prisma.gameSession.update({
      where: { id: sessionId },
      data: { textPlan: plan },
    });
  }

  private async note(data: LlmJobData, message: string, rejected: boolean): Promise<void> {
    try {
      if (rejected) {
        await this.redis.incr(LLM_REJECTED_KEY);
      }
      const line = JSON.stringify({
        at: this.clock.now().toISOString(),
        scenarioId: data.scenarioId,
        nodeId: data.nodeId,
        message,
      });
      await this.redis.lpush(LLM_ERRORS_KEY, line);
      await this.redis.ltrim(LLM_ERRORS_KEY, 0, LLM_ERROR_LIMIT - 1);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      this.logger.warn(`не записать ошибку LLM: ${text}`);
    }
  }
}

const REASONS: readonly LlmJobReason[] = ['seed', 'refill', 'live', 'manual'];

export function readJob(data: unknown): LlmJobData | null {
  if (typeof data !== 'object' || data === null) {
    return null;
  }
  const row = data as Partial<LlmJobData>;
  if (!row.scenarioId || !row.nodeId || !row.persona || typeof row.version !== 'number') {
    return null;
  }
  if (!row.reason || !REASONS.includes(row.reason)) {
    return null;
  }
  return {
    scenarioId: row.scenarioId,
    version: row.version,
    nodeId: row.nodeId,
    persona: row.persona,
    reason: row.reason,
    sessionId: typeof row.sessionId === 'string' ? row.sessionId : undefined,
  };
}

function readPlan(value: unknown): Record<string, string | null> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }
  const plan: Record<string, string | null> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string' || item === null) {
      plan[key] = item;
    }
  }
  return plan;
}

function nodeShown(state: unknown, nodeId: string): boolean {
  if (typeof state !== 'object' || state === null) {
    return false;
  }
  const record = state as { nodeId?: unknown; journal?: unknown };
  if (record.nodeId === nodeId) {
    return true;
  }
  if (!Array.isArray(record.journal)) {
    return false;
  }
  return record.journal.some(
    (entry) =>
      typeof entry === 'object' &&
      entry !== null &&
      (entry as { nodeId?: unknown }).nodeId === nodeId,
  );
}
