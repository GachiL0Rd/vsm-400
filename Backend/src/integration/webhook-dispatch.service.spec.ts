import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebhookDeliveryStatus } from '../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { WebhookDispatchService } from './webhook-dispatch.service';
import { VSM_SIGNATURE, VSM_TIMESTAMP, verifyWebhook } from './webhook-signature';

const secret = 'hook-secret';
const id = randomUUID();

function row(attempts: number, active = true) {
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
      url: 'https://lms.example/hook',
      secret,
      active,
      apiClient: { revokedAt: null },
    },
  };
}

function serviceFor(loaded: ReturnType<typeof row>) {
  const update = vi.fn();
  const prisma = {
    webhookDelivery: {
      findMany: vi.fn().mockResolvedValue([{ id }]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUnique: vi.fn().mockResolvedValue(loaded),
      update,
    },
  };
  return {
    update,
    service: new WebhookDispatchService(prisma as unknown as PrismaService),
  };
}

describe('доставка вебхука', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('подписывает успешный POST', async () => {
    const { service, update } = serviceFor(row(0));
    let body = '';
    let signature = '';
    let timestamp = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        body = String(init.body);
        const headers = init.headers as Record<string, string>;
        signature = headers[VSM_SIGNATURE] ?? '';
        timestamp = headers[VSM_TIMESTAMP] ?? '';
        return new Response('ok', { status: 200 });
      }),
    );
    const now = new Date('2026-09-26T12:00:00.000Z');
    await service.dispatch(now);
    expect(verifyWebhook(secret, timestamp, body, signature)).toBe(true);
    expect(JSON.parse(body)).toMatchObject({
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
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('no', { status: 500 })),
    );

    const first = serviceFor(row(0));
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

    const last = serviceFor(row(7));
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
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { service, update } = serviceFor(row(0, false));
    await service.dispatch(new Date());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({
      where: { id },
      data: { status: WebhookDeliveryStatus.FAILED, attempts: 1, lastError: 'inactive' },
    });
  });
});
