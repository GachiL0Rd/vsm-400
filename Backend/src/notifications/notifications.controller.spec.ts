import { VersioningType } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { ZodValidationPipe } from 'nestjs-zod';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../auth/auth-user';
import { ProblemFilter } from '../common/problem.filter';
import { NotificationKind, Role } from '../generated/prisma/client';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

const user: AuthUser = {
  id: '018f1a2b-3c4d-7e5f-8a9b-0c1d2e3f4a5b',
  role: Role.CONDUCTOR,
  brigadeId: null,
  depotId: null,
};

describe('HTTP уведомлений', () => {
  let app: NestFastifyApplication;
  const list = vi.fn(async () => ({
    unreadCount: 1,
    items: [
      {
        id: 'n1',
        kind: NotificationKind.expiring,
        title: '120 баллов спишутся 29 сентября',
        text: 'Баллы сохранятся, если до этой даты пройти хотя бы один рейс.',
        at: '2026-09-26T09:00:00.000Z',
        unread: true,
      },
    ],
    nextCursor: null,
  }));
  const markRead = vi.fn(async () => ({
    id: 'n1',
    kind: NotificationKind.expiring,
    title: '120 баллов спишутся 29 сентября',
    text: 'Баллы сохранятся, если до этой даты пройти хотя бы один рейс.',
    at: '2026-09-26T09:00:00.000Z',
    unread: false,
  }));
  const markAllRead = vi.fn(async () => ({ unreadCount: 0 }));

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [
        {
          provide: NotificationsService,
          useValue: { list, markRead, markAllRead, stream: vi.fn() },
        },
      ],
    }).compile();
    app = moduleRef.createNestApplication(new FastifyAdapter({ bodyLimit: 1_048_576 }), {
      logger: false,
    });
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new ZodValidationPipe());
    app.useGlobalFilters(new ProblemFilter());
    const fastify = app.getHttpAdapter().getInstance();
    fastify.addHook('onRequest', (request, _reply, done) => {
      const headers = request.headers as { 'x-test-user'?: string | string[] };
      if (headers['x-test-user'] !== '0') {
        (request as { user?: AuthUser }).user = user;
      }
      done();
    });
    await app.init();
    await fastify.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('лента, прочтение одного и всех', async () => {
    const http = app.getHttpAdapter().getInstance();
    const page = await http.inject({ method: 'GET', url: '/api/v1/notifications?limit=10' });
    expect(page.statusCode).toBe(200);
    expect(page.json()).toMatchObject({
      unreadCount: 1,
      items: [{ kind: 'expiring', unread: true }],
    });
    expect(list).toHaveBeenCalledWith(user.id, 10, undefined);

    const one = await http.inject({ method: 'POST', url: '/api/v1/notifications/n1/read' });
    expect(one.statusCode).toBe(200);
    expect(one.json()).toMatchObject({ unread: false });

    const all = await http.inject({ method: 'POST', url: '/api/v1/notifications/read-all' });
    expect(all.statusCode).toBe(200);
    expect(all.json()).toEqual({ unreadCount: 0 });
  });

  it('без пользователя 401', async () => {
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'GET',
        url: '/api/v1/notifications',
        headers: { 'x-test-user': '0' },
      });
    expect(response.statusCode).toBe(401);
    expect(response.headers['content-type']).toContain('application/problem+json');
  });
});
