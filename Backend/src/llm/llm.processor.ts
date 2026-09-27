import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { Clock } from '../common/clock';
import { APP_CONFIG, type AppConfig } from '../config/env';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { RulesService } from '../rules/rules.service';
import { buildJudgeMessages, judgeOutcome, parseJudgeText, reviewStatus } from './judge';
import {
  LLM_ERROR_LIMIT,
  LLM_ERRORS_KEY,
  LLM_JUDGE_PROVIDER,
  LLM_PROVIDER,
  LLM_QUEUE,
  LLM_RATE_MAX,
  LLM_RATE_WINDOW_MS,
  LLM_REJECTED_KEY,
  LLM_WORKER_CONCURRENCY,
  type LlmJobData,
  type LlmJobReason,
  variantReason,
} from './llm.constants';
import { avoidForJob } from './pool-plan';
import { buildMessages, PROMPT_VERSION, SCHEMA_NAME, variantJsonSchema } from './prompt';
import type { LlmProvider } from './provider';
import { bundleText, decisionNodes, parseStoredGraph, sourceOf } from './scenario-nodes';
import { similarityHit, similarityReason } from './similarity';
import { applicableKeep } from './text-norm';
import { readVariantPayload, type VariantPayload, validateVariant } from './validate-variant';
import { VariantPoolService } from './variant-pool.service';

const EXISTING_LIMIT = 200;

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
    @Inject(LLM_JUDGE_PROVIDER) private readonly judgeProvider: LlmProvider,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(VariantPoolService) private readonly pool: VariantPoolService,
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
    const existing = await this.loadExisting(data);
    let generated: { content: string; model: string };
    try {
      generated = await this.generate(data, loaded, existing);
    } catch (error) {
      await this.note(data, errorText(error), false);
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
    const similar = similarityHit(
      verdict.payload,
      loaded.source,
      existing,
      this.rules.llm().maxSimilarity,
    );
    if (similar) {
      const reason = similarityReason(similar);
      await this.save(data, generated.model, verdict.payload, 'REJECTED', reason);
      await this.note(data, reason, true);
      return;
    }
    const judgeEnabled = this.config.llmJudge && this.judgeProvider.name !== 'none';
    if (judgeEnabled) {
      let reason: string | null;
      try {
        reason = await this.judgeVerdict(loaded.source, verdict.payload);
      } catch (error) {
        await this.note(data, errorText(error), false);
        throw error;
      }
      if (reason) {
        await this.save(data, generated.model, verdict.payload, 'REJECTED', reason);
        await this.note(data, reason, true);
        return;
      }
    }
    const status = reviewStatus(this.rules.llm().autoApprove, judgeEnabled);
    await this.save(data, generated.model, verdict.payload, status, null);
    if (data.reason === 'live' && data.sessionId && status === 'APPROVED') {
      await this.pool.bindLive({
        sessionId: data.sessionId,
        scenarioId: data.scenarioId,
        version: data.version,
        nodeId: data.nodeId,
      });
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

  private async loadExisting(
    data: LlmJobData,
  ): Promise<{ id: string; persona: string; payload: VariantPayload }[]> {
    const rows = await this.prisma.scenarioTextVariant.findMany({
      where: { scenarioId: data.scenarioId, version: data.version, nodeId: data.nodeId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: EXISTING_LIMIT,
      select: { id: true, persona: true, payload: true },
    });
    const existing: { id: string; persona: string; payload: VariantPayload }[] = [];
    for (const row of rows) {
      const payload = readVariantPayload(row.payload);
      if (payload) {
        existing.push({ id: row.id, persona: row.persona, payload });
      }
    }
    return existing;
  }

  private async generate(
    data: LlmJobData,
    loaded: { source: ReturnType<typeof sourceOf>; keep: string[]; forbid: string[] },
    existing: readonly { id: string; persona: string; payload: VariantPayload }[],
  ): Promise<{ content: string; model: string }> {
    const avoid = avoidForJob(existing, data.persona).map((row) => row.payload);
    return this.provider.complete({
      messages: buildMessages({
        persona: data.persona,
        keep: loaded.keep,
        forbid: loaded.forbid,
        text: loaded.source.text,
        choices: loaded.source.choices,
        avoid,
      }),
      jsonSchema: variantJsonSchema(loaded.source.choices.map((choice) => choice.id)),
      schemaName: SCHEMA_NAME,
    });
  }

  private async judgeVerdict(
    source: ReturnType<typeof sourceOf>,
    payload: VariantPayload,
  ): Promise<string | null> {
    const ids = payload.choices.map((choice) => choice.id);
    const first = await this.askJudge(buildJudgeMessages(source, payload));
    let parsed = parseJudgeText(first, ids);
    if (!judgeReady(first, parsed)) {
      const retried = await this.retryJudge(source, payload, ids);
      if (!retried) {
        return 'judge-unparsed';
      }
      parsed = retried;
    }
    const outcome = judgeOutcome(parsed);
    return outcome.passed ? null : outcome.reason;
  }

  private async retryJudge(
    source: ReturnType<typeof sourceOf>,
    payload: VariantPayload,
    ids: readonly string[],
  ): Promise<ReturnType<typeof parseJudgeText> | null> {
    const second = await this.askJudge(buildJudgeMessages(source, payload, true));
    const parsed = parseJudgeText(second, ids);
    if (!judgeReady(second, parsed)) {
      return null;
    }
    return parsed;
  }

  private async askJudge(messages: ReturnType<typeof buildJudgeMessages>): Promise<string> {
    const judged = await this.judgeProvider.complete({
      messages,
      temperature: 0,
      topP: 1,
    });
    this.logger.debug(`судья сырой ответ: ${judged.content}`);
    return judged.content;
  }

  private async save(
    data: LlmJobData,
    model: string,
    payload: VariantPayload,
    status: 'APPROVED' | 'PENDING_REVIEW' | 'REJECTED',
    rejectReason: string | null,
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
        status,
        maxUses: rules.maxUses,
        reason: variantReason(data.reason),
        sessionId: data.reason === 'live' ? (data.sessionId ?? null) : null,
        rejectReason,
      },
      select: { id: true },
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
      this.logger.warn(`не записать ошибку LLM: ${errorText(error)}`);
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

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function judgeReady(content: string, parsed: ReturnType<typeof parseJudgeText>): boolean {
  return content.trim().length > 0 && parsed.missing.length === 0;
}
