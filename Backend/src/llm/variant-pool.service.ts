import { InjectQueue } from '@nestjs/bullmq';
import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { JobType, Queue } from 'bullmq';
import { Clock } from '../common/clock';
import { APP_CONFIG, type AppConfig } from '../config/env';
import type { Prisma, TextVariantStatus } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { RulesService } from '../rules/rules.service';
import { lockSession } from '../sessions/session-lock';
import {
  livePinTarget,
  markShown,
  readTextPlan,
  type StoredTextPlan,
  textPlanKey,
  writeTextPlan,
} from '../sessions/text-plan';
import {
  LLM_ERRORS_KEY,
  LLM_JOB_NAME,
  LLM_PROVIDER,
  LLM_QUEUE,
  LLM_REJECTED_KEY,
  type LlmJobData,
} from './llm.constants';
import { personaAt, priorityOf, seedDeficit } from './pool-plan';
import type { LlmProvider } from './provider';
import { decisionNodes, parseStoredGraph } from './scenario-nodes';
import type { VariantPayload } from './validate-variant';

const INFLIGHT: JobType[] = ['waiting', 'prioritized', 'delayed', 'active', 'paused'];

export type VariantView = {
  id: string;
  scenarioId: string;
  version: number;
  nodeId: string;
  persona: string;
  promptVersion: string;
  model: string;
  payload: VariantPayload;
  status: TextVariantStatus;
  uses: number;
  maxUses: number;
  createdAt: string;
  reviewedAt: string | null;
  rejectReason: string | null;
  reason: 'SEED' | 'REFILL' | 'LIVE' | 'MANUAL';
  sessionId: string | null;
};

export type PoolBucket = {
  scenarioId: string;
  version: number;
  approved: number;
  pending: number;
  rejected: number;
  retired: number;
};

export type LlmStatusView = {
  provider: string;
  model: string | null;
  queue: { waiting: number; active: number; failed: number; delayed: number };
  rejected: number;
  pool: PoolBucket[];
  errors: { at: string; scenarioId: string; nodeId: string; message: string }[];
};

type PickRng = { pick: <T>(items: readonly T[]) => T };

type VariantRow = {
  id: string;
  scenarioId: string;
  version: number;
  nodeId: string;
  persona: string;
  promptVersion: string;
  model: string;
  payload: Prisma.JsonValue;
  status: TextVariantStatus;
  uses: number;
  maxUses: number;
  createdAt: Date;
  reviewedAt: Date | null;
  rejectReason: string | null;
  reason: 'SEED' | 'REFILL' | 'LIVE' | 'MANUAL';
  sessionId: string | null;
};

@Injectable()
export class VariantPoolService implements OnApplicationBootstrap {
  private readonly logger = new Logger(VariantPoolService.name);
  private poolRun: Promise<void> | null = null;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RulesService) private readonly rules: RulesService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(LLM_PROVIDER) private readonly provider: LlmProvider,
    @InjectQueue(LLM_QUEUE) private readonly queue: Queue<LlmJobData>,
  ) {}

  onApplicationBootstrap(): Promise<void> {
    return this.ensurePool();
  }

  @Cron(CronExpression.EVERY_10_MINUTES, { name: 'llm-ensure-pool' })
  ensurePool(): Promise<void> {
    if (this.provider.name === 'none') {
      return Promise.resolve();
    }
    if (this.poolRun) {
      return this.poolRun;
    }
    this.poolRun = this.fillPool().finally(() => {
      this.poolRun = null;
    });
    return this.poolRun;
  }

  async pick(
    scenarioId: string,
    version: number,
    nodeId: string,
    rng: PickRng,
    filter?: { persona?: string },
  ): Promise<{ id: string; payload: VariantPayload } | null> {
    const rows = await this.prisma.scenarioTextVariant.findMany({
      where: {
        scenarioId,
        version,
        nodeId,
        status: 'APPROVED',
        sessionId: null,
        ...(filter?.persona ? { persona: filter.persona } : {}),
      },
      orderBy: { id: 'asc' },
    });
    if (rows.length === 0) {
      return null;
    }
    const ordered = [...rows].sort(byVariantId);
    const chosen = rng.pick(ordered);
    const payload = asPayload(chosen.payload);
    if (!payload) {
      return null;
    }
    return { id: chosen.id, payload };
  }

  async markUsed(ids: readonly string[], db: VariantStore = this.prisma): Promise<void> {
    for (const id of ids) {
      const refill = await this.consume(db, id);
      if (refill) {
        await this.enqueue(refill);
      }
    }
  }

  /**
   * Пустой live-слот получает вариант именно этой сессии.
   * Чужой APPROVED той же персоны не берётся. Нет строки — слот замерзает на YAML.
   */
  async bindLive(input: {
    sessionId: string;
    scenarioId: string;
    version: number;
    nodeId: string;
  }): Promise<StoredTextPlan | null> {
    const refills: LlmJobData[] = [];
    const plan = await this.prisma.$transaction(async (tx) => {
      await lockSession(tx, input.sessionId);
      const session = await tx.gameSession.findUnique({
        where: { id: input.sessionId },
        select: { textPlan: true },
      });
      if (!session) {
        return null;
      }
      const current = readTextPlan(session.textPlan);
      const key = textPlanKey(input.scenarioId, input.nodeId);
      if (!current || !livePinTarget(current, key, 'live')) {
        return current;
      }
      const fresh = await tx.scenarioTextVariant.findFirst({
        where: {
          sessionId: input.sessionId,
          scenarioId: input.scenarioId,
          version: input.version,
          nodeId: input.nodeId,
          status: 'APPROVED',
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true },
      });
      const next = markShown(current, key, fresh?.id ?? null);
      if (fresh) {
        const refill = await this.consume(tx, fresh.id);
        if (refill) {
          refills.push(refill);
        }
      }
      await tx.gameSession.update({
        where: { id: input.sessionId },
        data: { textPlan: writeTextPlan(next) },
      });
      return next;
    });
    for (const refill of refills) {
      await this.enqueue(refill);
    }
    return plan;
  }

  /** APPROVED живой сессии после её конца попадает в общий пул. Остальные статусы нет. */
  async releaseSession(sessionId: string): Promise<number> {
    const updated = await this.prisma.scenarioTextVariant.updateMany({
      where: { sessionId, status: 'APPROVED' },
      data: { sessionId: null },
    });
    return updated.count;
  }

  async enqueueLive(
    sessionId: string,
    nodes: readonly { scenarioId: string; version: number; nodeId: string }[],
    persona: string,
  ): Promise<number> {
    if (this.provider.name === 'none') {
      return 0;
    }
    let enqueued = 0;
    for (const node of nodes) {
      await this.enqueue({ ...node, persona, reason: 'live', sessionId });
      enqueued += 1;
    }
    return enqueued;
  }

  async list(
    scenarioId: string,
    status?: TextVariantStatus,
    nodeId?: string,
  ): Promise<VariantView[]> {
    await this.requireScenario(scenarioId);
    const rows = await this.prisma.scenarioTextVariant.findMany({
      where: { scenarioId, status, nodeId },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map(toView);
  }

  async approve(scenarioId: string, variantId: string, userId: string): Promise<VariantView> {
    return this.review(scenarioId, variantId, userId, 'APPROVED');
  }

  async reject(
    scenarioId: string,
    variantId: string,
    userId: string,
    reason: string,
  ): Promise<VariantView> {
    return this.review(scenarioId, variantId, userId, 'REJECTED', reason);
  }

  async generate(scenarioId: string, nodeId: string | undefined, count: number): Promise<number> {
    this.assertEnabled();
    const version = await this.currentGraph(scenarioId);
    const nodes = this.targetNodes(version.graph, nodeId);
    let enqueued = 0;
    for (let index = 0; index < count; index += 1) {
      const node = nodes[index % nodes.length];
      if (!node) {
        continue;
      }
      await this.enqueue({
        scenarioId,
        version: version.version,
        nodeId: node,
        persona: personaAt(version.personas, index),
        reason: 'manual',
      });
      enqueued += 1;
    }
    return enqueued;
  }

  async status(): Promise<LlmStatusView> {
    const [counts, rejectedRaw, errorLines, grouped] = await Promise.all([
      this.queue.getJobCounts('waiting', 'active', 'failed', 'delayed'),
      this.redis.get(LLM_REJECTED_KEY),
      this.redis.lrange(LLM_ERRORS_KEY, 0, 19),
      this.prisma.scenarioTextVariant.groupBy({
        by: ['scenarioId', 'version', 'status'],
        _count: { _all: true },
      }),
    ]);
    return {
      provider: this.provider.name,
      model: this.config.llmModel ?? null,
      queue: {
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        failed: counts.failed ?? 0,
        delayed: counts.delayed ?? 0,
      },
      rejected: Number(rejectedRaw ?? 0) || 0,
      pool: buckets(grouped),
      errors: errorLines.map(parseError).filter((item) => item !== null),
    };
  }

  private async fillPool(): Promise<void> {
    const target = this.rules.llm().poolTarget;
    const scenarios = await this.prisma.scenario.findMany({
      where: { status: 'PUBLISHED', currentVersion: { gt: 0 } },
      orderBy: { id: 'asc' },
    });
    for (const scenario of scenarios) {
      const stored = await this.prisma.scenarioVersion.findUnique({
        where: {
          scenarioId_version: { scenarioId: scenario.id, version: scenario.currentVersion },
        },
      });
      const graph = stored ? parseStoredGraph(stored.graph) : null;
      if (!graph?.llm?.enabled) {
        continue;
      }
      for (const node of decisionNodes(graph)) {
        await this.topUp(scenario.id, scenario.currentVersion, node.id, graph.llm.personas, target);
      }
    }
  }

  private async topUp(
    scenarioId: string,
    version: number,
    nodeId: string,
    personas: string[] | undefined,
    target: number,
  ): Promise<void> {
    const [approved, inflight] = await Promise.all([
      this.prisma.scenarioTextVariant.count({
        where: { scenarioId, version, nodeId, status: 'APPROVED', sessionId: null },
      }),
      this.inflight(scenarioId, version, nodeId),
    ]);
    const deficit = seedDeficit(target, approved, inflight);
    for (let index = 0; index < deficit; index += 1) {
      await this.enqueue({
        scenarioId,
        version,
        nodeId,
        persona: personaAt(personas, approved + inflight + index),
        reason: 'seed',
      });
    }
  }

  private async inflight(scenarioId: string, version: number, nodeId: string): Promise<number> {
    const jobs = await this.queue.getJobs(INFLIGHT, 0, 200);
    return jobs.filter(
      (job) =>
        job.data.scenarioId === scenarioId &&
        job.data.version === version &&
        job.data.nodeId === nodeId,
    ).length;
  }

  private async consume(db: VariantStore, id: string): Promise<LlmJobData | null> {
    const row = await db.scenarioTextVariant.update({
      where: { id },
      data: { uses: { increment: 1 } },
    });
    if (row.status !== 'APPROVED' || row.uses < row.maxUses) {
      return null;
    }
    const retired = await db.scenarioTextVariant.updateMany({
      where: { id, status: 'APPROVED' },
      data: { status: 'RETIRED' },
    });
    if (retired.count !== 1) {
      return null;
    }
    this.logger.log(`вариант ${id} исчерпан, в очередь refill ${row.nodeId}`);
    return {
      scenarioId: row.scenarioId,
      version: row.version,
      nodeId: row.nodeId,
      persona: row.persona,
      reason: 'refill',
    };
  }

  private async enqueue(data: LlmJobData): Promise<void> {
    await this.queue.add(LLM_JOB_NAME, data, { priority: priorityOf(data.reason) });
  }

  private assertEnabled(): void {
    if (this.provider.name === 'none') {
      throw new ConflictException({
        message: 'LLM выключен, пул не пополняется',
        code: 'LLM_DISABLED',
      });
    }
  }

  private async currentGraph(scenarioId: string): Promise<{
    version: number;
    graph: NonNullable<ReturnType<typeof parseStoredGraph>>;
    personas: string[] | undefined;
  }> {
    const scenario = await this.requireScenario(scenarioId);
    if (scenario.currentVersion < 1) {
      throw new NotFoundException({ message: 'Версия сценария не найдена', code: 'NOT_FOUND' });
    }
    const stored = await this.prisma.scenarioVersion.findUnique({
      where: {
        scenarioId_version: { scenarioId, version: scenario.currentVersion },
      },
    });
    const graph = stored ? parseStoredGraph(stored.graph) : null;
    if (!graph) {
      throw new NotFoundException({ message: 'Версия сценария не найдена', code: 'NOT_FOUND' });
    }
    if (!graph.llm?.enabled) {
      throw new ConflictException({
        message: 'У сценария выключены перефразы',
        code: 'LLM_DISABLED',
      });
    }
    return { version: scenario.currentVersion, graph, personas: graph.llm.personas };
  }

  private targetNodes(
    graph: NonNullable<ReturnType<typeof parseStoredGraph>>,
    nodeId: string | undefined,
  ): string[] {
    const nodes = decisionNodes(graph).map((item) => item.id);
    if (!nodeId) {
      if (nodes.length === 0) {
        throw new NotFoundException({ message: 'Узел не найден', code: 'NOT_FOUND' });
      }
      return nodes;
    }
    if (!nodes.includes(nodeId)) {
      throw new NotFoundException({ message: 'Узел не найден', code: 'NOT_FOUND' });
    }
    return [nodeId];
  }

  private async requireScenario(scenarioId: string): Promise<{ currentVersion: number }> {
    const scenario = await this.prisma.scenario.findUnique({ where: { id: scenarioId } });
    if (!scenario) {
      throw new NotFoundException({ message: 'Сценарий не найден', code: 'NOT_FOUND' });
    }
    return scenario;
  }

  private async review(
    scenarioId: string,
    variantId: string,
    userId: string,
    status: 'APPROVED' | 'REJECTED',
    reason?: string,
  ): Promise<VariantView> {
    await this.requireScenario(scenarioId);
    const row = await this.prisma.scenarioTextVariant.findFirst({
      where: { id: variantId, scenarioId },
    });
    if (!row) {
      throw new NotFoundException({ message: 'Вариант не найден', code: 'NOT_FOUND' });
    }
    if (row.status !== 'PENDING_REVIEW') {
      throw new ConflictException({
        message: 'Вариант уже разобран',
        code: 'CONFLICT',
      });
    }
    const updated = await this.prisma.scenarioTextVariant.update({
      where: { id: variantId },
      data: {
        status,
        reviewedById: userId,
        reviewedAt: this.clock.now(),
        rejectReason: status === 'REJECTED' ? reason : null,
      },
    });
    if (status === 'APPROVED' && updated.sessionId) {
      const released = await this.releaseIfSessionClosed(updated.sessionId, updated.id);
      if (released) {
        return toView({ ...updated, sessionId: null });
      }
    }
    return toView(updated);
  }

  private async releaseIfSessionClosed(sessionId: string, variantId: string): Promise<boolean> {
    const session = await this.prisma.gameSession.findUnique({
      where: { id: sessionId },
      select: { status: true },
    });
    if (session && (session.status === 'PENDING' || session.status === 'ACTIVE')) {
      return false;
    }
    await this.prisma.scenarioTextVariant.update({
      where: { id: variantId },
      data: { sessionId: null },
    });
    return true;
  }
}

function toView(row: VariantRow): VariantView {
  const payload = asPayload(row.payload) ?? { text: '', choices: [] };
  return {
    id: row.id,
    scenarioId: row.scenarioId,
    version: row.version,
    nodeId: row.nodeId,
    persona: row.persona,
    promptVersion: row.promptVersion,
    model: row.model,
    payload,
    status: row.status,
    uses: row.uses,
    maxUses: row.maxUses,
    createdAt: row.createdAt.toISOString(),
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
    rejectReason: row.rejectReason,
    reason: row.reason,
    sessionId: row.sessionId,
  };
}

type VariantStore = PrismaService | Prisma.TransactionClient;

function byVariantId(left: { id: string }, right: { id: string }): number {
  if (left.id < right.id) {
    return -1;
  }
  if (left.id > right.id) {
    return 1;
  }
  return 0;
}

function asPayload(value: unknown): VariantPayload | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record = value as { text?: unknown; choices?: unknown };
  if (typeof record.text !== 'string' || !Array.isArray(record.choices)) {
    return null;
  }
  const choices: { id: string; text: string }[] = [];
  for (const item of record.choices) {
    if (typeof item !== 'object' || item === null) {
      return null;
    }
    const choice = item as { id?: unknown; text?: unknown };
    if (typeof choice.id !== 'string' || typeof choice.text !== 'string') {
      return null;
    }
    choices.push({ id: choice.id, text: choice.text });
  }
  return { text: record.text, choices };
}

function buckets(
  grouped: {
    scenarioId: string;
    version: number;
    status: TextVariantStatus;
    _count: { _all: number };
  }[],
): PoolBucket[] {
  const map = new Map<string, PoolBucket>();
  for (const row of grouped) {
    const key = `${row.scenarioId}:${row.version}`;
    const bucket = map.get(key) ?? {
      scenarioId: row.scenarioId,
      version: row.version,
      approved: 0,
      pending: 0,
      rejected: 0,
      retired: 0,
    };
    addStatus(bucket, row.status, row._count._all);
    map.set(key, bucket);
  }
  return [...map.values()];
}

function addStatus(bucket: PoolBucket, status: TextVariantStatus, count: number): void {
  if (status === 'APPROVED') {
    bucket.approved += count;
  } else if (status === 'PENDING_REVIEW') {
    bucket.pending += count;
  } else if (status === 'REJECTED') {
    bucket.rejected += count;
  } else if (status === 'RETIRED') {
    bucket.retired += count;
  }
}

function parseError(line: string): LlmStatusView['errors'][number] | null {
  try {
    const value = JSON.parse(line) as {
      at?: unknown;
      scenarioId?: unknown;
      nodeId?: unknown;
      message?: unknown;
    };
    if (
      typeof value.at !== 'string' ||
      typeof value.scenarioId !== 'string' ||
      typeof value.nodeId !== 'string' ||
      typeof value.message !== 'string'
    ) {
      return null;
    }
    return {
      at: value.at,
      scenarioId: value.scenarioId,
      nodeId: value.nodeId,
      message: value.message,
    };
  } catch {
    return null;
  }
}
