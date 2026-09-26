import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { SystemClock } from '../common/clock';
import type { AppConfig } from '../config/env';
import { WebhookDeliveryStatus } from '../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { WebhookDispatchService } from './webhook-dispatch.service';
import type { WebhookPost, WebhookPostInput } from './webhook-post';
import { VSM_SIGNATURE, VSM_TIMESTAMP, verifyWebhook } from './webhook-signature';
import type { WebhookResolve } from './webhook-url';

const secret = 'hook-secret';
const id = randomUUID();
const publicAddress = { address: '203.0.113.10', family: 4 as const };

function row(attempts: number, active = true, url = 'https://lms.example/hook') {
  return {
    id,
    event: 'run.recorded',
    attempts,
    payload: {
      id,
      event: 'run.recorded',
      occurredAt: '2026-09-26T00:00:00.000Z',
      data: { userId: 'user-1', callsign: 'A7F3', runId: 'run-1' },
    },
    subscription: {
      url,
      secret,
      active,
      apiClient: { revokedAt: null },
    },
  };
}

function serviceFor(
  loaded: ReturnType<typeof row>,
  resolve: WebhookResolve = async () => [publicAddress],
  post: WebhookPost = vi.fn(async () => ({ status: 200 })),
) {
  const update = vi.fn();
  const prisma = {
    webhookDelivery: {
      findMany: vi.fn().mockResolvedValue([{ id }]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUnique: vi.fn().mockResolvedValue(loaded),
      update,
    },
  };
  const config = { nodeEnv: 'production', webhookAllowedHosts: [] } as unknown as AppConfig;
  return {
    update,
    post,
    service: new WebhookDispatchService(
      prisma as unknown as PrismaService,
      config,
      resolve,
      post,
      new SystemClock(),
    ),
  };
}

describe('доставка вебхука', () => {
  it('подписывает успешный POST на уже проверенный адрес', async () => {
    let sent: WebhookPostInput | undefined;
    let calls = 0;
    const post: WebhookPost = async (input) => {
      calls += 1;
      sent = input;
      return { status: 200 };
    };
    const { service, update } = serviceFor(row(0), async () => [publicAddress], post);
    const now = new Date('2026-09-26T12:00:00.000Z');
    await service.dispatch(now);
    expect(calls).toBe(1);
    expect(sent?.addresses).toEqual([publicAddress]);
    expect(
      verifyWebhook(
        secret,
        sent?.headers[VSM_TIMESTAMP] ?? '',
        sent?.body ?? '',
        sent?.headers[VSM_SIGNATURE] ?? '',
      ),
    ).toBe(true);
    expect(JSON.parse(sent?.body ?? '{}')).toMatchObject({
      event: 'run.recorded',
      data: { userId: 'user-1', callsign: 'A7F3' },
    });
    expect(update).toHaveBeenCalledWith({
      where: { id },
      data: { status: WebhookDeliveryStatus.SENT, attempts: 1, lastError: null },
    });
  });

  it('после первой неудачи ждёт 30 секунд, на восьмой закрывает', async () => {
    const now = new Date('2026-09-26T12:00:00.000Z');
    const post = vi.fn(async () => ({ status: 500 }));

    const first = serviceFor(row(0), async () => [publicAddress], post);
    await first.service.dispatch(now);
    expect(first.update).toHaveBeenCalledWith({
      where: { id },
      data: {
        status: WebhookDeliveryStatus.PENDING,
        attempts: 1,
        nextAttemptAt: new Date(now.getTime() + 30_000),
        lastError: 'HTTP 500',
      },
    });

    const last = serviceFor(row(7), async () => [publicAddress], post);
    await last.service.dispatch(now);
    expect(last.update).toHaveBeenCalledWith({
      where: { id },
      data: {
        status: WebhookDeliveryStatus.FAILED,
        attempts: 8,
        nextAttemptAt: now,
        lastError: 'HTTP 500',
      },
    });
  });

  it('неактивную подписку не шлёт', async () => {
    const post = vi.fn(async () => ({ status: 200 }));
    const { service, update } = serviceFor(row(0, false), async () => [publicAddress], post);
    await service.dispatch(new Date());
    expect(post).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({
      where: { id },
      data: { status: WebhookDeliveryStatus.FAILED, attempts: 1, lastError: 'inactive' },
    });
  });

  it('не шлёт http в production и частный адрес', async () => {
    const post = vi.fn(async () => ({ status: 200 }));
    const httpHook = serviceFor(
      row(0, true, 'http://lms.example/hook'),
      async () => [publicAddress],
      post,
    );
    await httpHook.service.dispatch(new Date('2026-09-26T12:00:00.000Z'));
    expect(post).not.toHaveBeenCalled();
    expect(httpHook.update).toHaveBeenCalledWith({
      where: { id },
      data: expect.objectContaining({ status: WebhookDeliveryStatus.FAILED, lastError: 'https' }),
    });

    const privateDns = vi.fn(async () => ({ status: 200 }));
    const loopback = serviceFor(
      row(0),
      async () => [{ address: '127.0.0.1', family: 4 }],
      privateDns,
    );
    await loopback.service.dispatch(new Date('2026-09-26T12:00:00.000Z'));
    expect(privateDns).not.toHaveBeenCalled();
    expect(loopback.update).toHaveBeenCalledWith({
      where: { id },
      data: expect.objectContaining({ lastError: 'ssrf' }),
    });
  });
});
