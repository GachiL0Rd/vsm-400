import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Clock } from '../common/clock';
import {
  ACHIEVEMENT_GRANTED,
  type AchievementGrantedPayload,
  PROMOTION_RECOMMENDED,
  type PromotionRecommendedPayload,
  RUN_RECORDED,
  type RunRecordedPayload,
} from '../common/events';
import { APP_CONFIG, type AppConfig } from '../config/env';
import type { Prisma } from '../generated/prisma/client';
import { WebhookDeliveryStatus } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { WebhookEvent } from './api-scopes';
import { nextDeliveryState } from './webhook-backoff';
import type { WebhookPost } from './webhook-post';
import {
  signWebhook,
  VSM_DELIVERY,
  VSM_EVENT,
  VSM_SIGNATURE,
  VSM_TIMESTAMP,
} from './webhook-signature';
import {
  screenWebhookUrl,
  WEBHOOK_POST,
  WEBHOOK_RESOLVE,
  type WebhookResolve,
} from './webhook-url';

type HookData = Record<string, string | number | boolean | null>;

const CLAIM_MS = 5 * 60 * 1000;
const BATCH = 10;
const POOL = 5;

type LoadedDelivery = {
  id: string;
  event: string;
  attempts: number;
  payload: Prisma.JsonValue;
  subscription: {
    url: string;
    secret: string;
    active: boolean;
    apiClient: { revokedAt: Date | null };
  };
};

@Injectable()
export class WebhookDispatchService {
  private readonly logger = new Logger(WebhookDispatchService.name);
  private running = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(WEBHOOK_RESOLVE) private readonly resolve: WebhookResolve,
    @Inject(WEBHOOK_POST) private readonly post: WebhookPost,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  /**
   * run.recorded, не сырой run.completed: к этому моменту очки уже в леджере,
   * и LMS получает ту же сумму, что кабинет.
   */
  @OnEvent(RUN_RECORDED, { async: true })
  async onRunRecorded(payload: RunRecordedPayload): Promise<void> {
    await this.safely(RUN_RECORDED, async () => {
      const callsign = await this.callsignOf(payload.userId);
      await this.enqueue(
        RUN_RECORDED,
        {
          userId: payload.userId,
          callsign,
          runId: payload.runId,
          points: payload.points,
          outcome: payload.outcome,
          suspicious: payload.suspicious,
        },
        { payload: { path: ['data', 'runId'], equals: payload.runId } },
      );
    });
  }

  @OnEvent(ACHIEVEMENT_GRANTED, { async: true })
  async onAchievement(payload: AchievementGrantedPayload): Promise<void> {
    await this.safely(ACHIEVEMENT_GRANTED, async () => {
      const callsign = await this.callsignOf(payload.userId);
      await this.enqueue(
        ACHIEVEMENT_GRANTED,
        {
          userId: payload.userId,
          callsign,
          code: payload.code,
          title: payload.title,
          bonusPoints: payload.bonusPoints,
        },
        {
          AND: [
            { payload: { path: ['data', 'userId'], equals: payload.userId } },
            { payload: { path: ['data', 'code'], equals: payload.code } },
          ],
        },
      );
    });
  }

  @OnEvent(PROMOTION_RECOMMENDED, { async: true })
  async onPromotion(payload: PromotionRecommendedPayload): Promise<void> {
    await this.safely(PROMOTION_RECOMMENDED, async () => {
      const callsign = await this.callsignOf(payload.userId);
      await this.enqueue(
        PROMOTION_RECOMMENDED,
        {
          userId: payload.userId,
          callsign,
          recommendationId: payload.recommendationId,
          fromGrade: payload.fromGrade,
          toGrade: payload.toGrade,
        },
        { payload: { path: ['data', 'recommendationId'], equals: payload.recommendationId } },
      );
    });
  }

  @Cron(CronExpression.EVERY_MINUTE, { name: 'integration-webhooks' })
  async dispatchDue(): Promise<void> {
    await this.dispatch(this.clock.now());
  }

  /** Флаг: минутный cron не должен догонять сам себя, пока fetch сидит в таймауте. */
  async dispatch(now: Date): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      const due = await this.prisma.webhookDelivery.findMany({
        where: { status: WebhookDeliveryStatus.PENDING, nextAttemptAt: { lte: now } },
        orderBy: { nextAttemptAt: 'asc' },
        take: BATCH,
        select: { id: true },
      });
      await mapPool(due, POOL, async (row) => {
        try {
          await this.deliver(row.id, now);
        } catch (error) {
          this.logger.error(error instanceof Error ? error.name : 'deliver');
        }
      });
    } finally {
      this.running = false;
    }
  }

  private async safely(event: string, work: () => Promise<void>): Promise<void> {
    try {
      await work();
    } catch (error) {
      this.logger.error(`${event}: ${error instanceof Error ? error.name : 'enqueue'}`);
    }
  }

  private async callsignOf(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { callsign: true },
    });
    return user?.callsign ?? null;
  }

  private async enqueue(
    event: WebhookEvent,
    data: HookData,
    duplicate: Prisma.WebhookDeliveryWhereInput,
  ): Promise<void> {
    const subscriptions = await this.prisma.webhookSubscription.findMany({
      where: {
        active: true,
        events: { has: event },
        apiClient: { revokedAt: null },
      },
      select: { id: true },
    });
    const occurredAt = this.clock.now().toISOString();
    for (const subscription of subscriptions) {
      await this.enqueueOne(subscription.id, event, data, occurredAt, duplicate);
    }
  }

  private async enqueueOne(
    subscriptionId: string,
    event: WebhookEvent,
    data: HookData,
    occurredAt: string,
    duplicate: Prisma.WebhookDeliveryWhereInput,
  ): Promise<void> {
    const existing = await this.prisma.webhookDelivery.findFirst({
      where: { subscriptionId, event, ...duplicate },
      select: { id: true },
    });
    if (existing) {
      return;
    }
    const id = randomUUID();
    await this.prisma.webhookDelivery.create({
      data: {
        id,
        event,
        payload: { id, event, occurredAt, data },
        nextAttemptAt: this.clock.now(),
        subscription: { connect: { id: subscriptionId } },
      },
    });
  }

  private async deliver(id: string, now: Date): Promise<void> {
    const claimed = await this.prisma.webhookDelivery.updateMany({
      where: { id, status: WebhookDeliveryStatus.PENDING, nextAttemptAt: { lte: now } },
      data: { nextAttemptAt: new Date(now.getTime() + CLAIM_MS) },
    });
    if (claimed.count !== 1) {
      return;
    }
    const row = await this.load(id);
    if (!row) {
      return;
    }
    const blocked = blockReason(row.subscription);
    if (blocked) {
      await this.failPermanent(id, row.attempts, blocked);
      return;
    }
    const screened = await screenWebhookUrl(
      row.subscription.url,
      { nodeEnv: this.config.nodeEnv, allowedHosts: this.config.webhookAllowedHosts },
      this.resolve,
    );
    if (!screened.ok) {
      // Сбой резолва временный. url, https, allowlist и ssrf ретраем не лечатся.
      if (screened.reason === 'dns') {
        await this.failTransient(id, row.attempts, now, 'dns');
        return;
      }
      await this.failPermanent(id, row.attempts, screened.reason);
      return;
    }
    const body = stringifyWebhookBody(row.payload);
    if (!body) {
      await this.failPermanent(id, row.attempts, 'payload');
      return;
    }
    await this.send(row, body, now, screened.addresses);
  }

  private async load(id: string): Promise<LoadedDelivery | null> {
    return this.prisma.webhookDelivery.findUnique({
      where: { id },
      include: {
        subscription: {
          select: {
            url: true,
            secret: true,
            active: true,
            apiClient: { select: { revokedAt: true } },
          },
        },
      },
    });
  }

  private async send(
    row: LoadedDelivery,
    body: string,
    now: Date,
    addresses: readonly { address: string; family: 4 | 6 }[],
  ): Promise<void> {
    const timestamp = String(Math.floor(now.getTime() / 1000));
    const signature = signWebhook(row.subscription.secret, timestamp, body);
    try {
      const response = await this.post({
        url: row.subscription.url,
        body,
        headers: {
          'content-type': 'application/json',
          'user-agent': 'vsm-webhooks',
          [VSM_EVENT]: row.event,
          [VSM_DELIVERY]: row.id,
          [VSM_SIGNATURE]: signature,
          [VSM_TIMESTAMP]: timestamp,
        },
        addresses,
      });
      if (response.status < 200 || response.status >= 300) {
        await this.failTransient(row.id, row.attempts, now, `HTTP ${response.status}`);
        return;
      }
      await this.markSent(row.id, row.attempts);
    } catch (error) {
      await this.failTransient(row.id, row.attempts, now, networkReason(error));
    }
  }

  private async markSent(id: string, attempts: number): Promise<void> {
    await this.prisma.webhookDelivery.update({
      where: { id },
      data: {
        status: WebhookDeliveryStatus.SENT,
        attempts: attempts + 1,
        lastError: null,
      },
    });
  }

  private async failTransient(
    id: string,
    attempts: number,
    now: Date,
    reason: string,
  ): Promise<void> {
    const next = nextDeliveryState(attempts, now, reason);
    await this.prisma.webhookDelivery.update({
      where: { id },
      data: {
        status: next.status,
        attempts: next.attempts,
        nextAttemptAt: next.nextAttemptAt,
        lastError: next.lastError,
      },
    });
  }

  private async failPermanent(id: string, attempts: number, reason: string): Promise<void> {
    await this.prisma.webhookDelivery.update({
      where: { id },
      data: {
        status: WebhookDeliveryStatus.FAILED,
        attempts: attempts + 1,
        lastError: reason,
      },
    });
  }
}

function blockReason(subscription: LoadedDelivery['subscription']): string | null {
  if (!subscription.active) {
    return 'inactive';
  }
  if (subscription.apiClient.revokedAt) {
    return 'revoked';
  }
  return null;
}

export function stringifyWebhookBody(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return null;
  }
  const record = payload as Record<string, unknown>;
  if (typeof record.id !== 'string' || typeof record.event !== 'string') {
    return null;
  }
  if (typeof record.occurredAt !== 'string') {
    return null;
  }
  if (typeof record.data !== 'object' || record.data === null || Array.isArray(record.data)) {
    return null;
  }
  return JSON.stringify(payload);
}

function networkReason(error: unknown): string {
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return 'timeout';
  }
  return 'network';
}

async function mapPool<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) {
    return;
  }
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      const item = items[current];
      if (item !== undefined) {
        await fn(item);
      }
    }
  });
  await Promise.all(workers);
}
