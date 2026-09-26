import { randomUUID } from 'node:crypto';
import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module';
import { AccessGuard } from '../src/auth/access.guard';
import type { AuthUser } from '../src/auth/auth-user';
import { IS_PUBLIC_KEY } from '../src/auth/public.decorator';
import { configureApp } from '../src/configure-app';
import { extHashOf, loginFromExtHash } from '../src/integration/ext-hash';
import { WebhookDispatchService } from '../src/integration/webhook-dispatch.service';
import { VSM_SIGNATURE, VSM_TIMESTAMP, verifyWebhook } from '../src/integration/webhook-signature';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';
import { ScenariosService } from '../src/scenarios/scenarios.service';
import { MemoryPrisma } from './memory-db';

const admin: AuthUser = {
  id: '018f1a2b-3c4d-7e5f-8a9b-0c1d2e3f4a5b',
  role: 'ADMIN',
  brigadeId: null,
  depotId: null,
};

@Injectable()
class AdminAccessGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets) === true) {
      return true;
    }
    const request = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    request.user = admin;
    return true;
  }
}

const extId = 'tab-unique-152fz';
const pepper = 'local-dev-ext-id-pepper';

type Injected = {
  statusCode: number;
  body: string;
  headers: Record<string, string | string[] | undefined>;
  json: () => unknown;
};

async function call(
  app: NestFastifyApplication,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  body?: unknown,
  apiKey?: string,
): Promise<Injected> {
  const headers: Record<string, string> = {};
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
  }
  if (apiKey) {
    headers['x-api-key'] = apiKey;
  }
  const response = await app
    .getHttpAdapter()
    .getInstance()
    .inject({
      method,
      url,
      headers,
      payload: body === undefined ? undefined : JSON.stringify(body),
    });
  return response as Injected;
}

describe('API интеграции HR', { concurrent: false }, () => {
  const memory = new MemoryPrisma();
  let app: NestFastifyApplication;
  let key = '';

  beforeAll(async () => {
    memory.seedOrg();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(memory)
      .overrideProvider(RedisService)
      .useValue({
        ping: vi.fn().mockResolvedValue('PONG'),
        quit: vi.fn(),
        connect: vi.fn(),
      })
      .overrideProvider(AccessGuard)
      .useClass(AdminAccessGuard)
      .overrideProvider(ScenariosService)
      .useValue({ onApplicationBootstrap: () => undefined })
      .compile();
    app = moduleRef.createNestApplication(new FastifyAdapter({ bodyLimit: 1_048_576 }), {
      logger: false,
    });
    await configureApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  }, 30_000);

  afterAll(async () => {
    await app.close();
  });

  it('выдаёт ключ один раз и прячет его в списке', async () => {
    const created = await call(app, 'POST', '/api/v1/admin/api-clients', {
      name: 'Кадры',
      scopes: ['employees:write', 'progress:read', 'org:read', 'webhooks:manage'],
    });
    expect(created.statusCode).toBe(201);
    const body = created.json() as { id: string; key: string; scopes: string[] };
    key = body.key;
    expect(key.startsWith(`vsm_${body.id}_`)).toBe(true);
    const listed = await call(app, 'GET', '/api/v1/admin/api-clients');
    expect(listed.statusCode).toBe(200);
    const rows = listed.json() as Record<string, unknown>[];
    expect(rows[0]).not.toHaveProperty('key');
    expect(rows[0]).not.toHaveProperty('keyHash');
    expect(JSON.stringify(rows)).not.toContain(key.slice(key.lastIndexOf('_') + 1));
  });

  it('отклоняет пустой, битый и узкий ключ', async () => {
    const narrow = await call(app, 'POST', '/api/v1/admin/api-clients', {
      name: 'Только орг',
      scopes: ['org:read'],
    });
    const narrowKey = (narrow.json() as { key: string }).key;
    const missing = await call(app, 'GET', '/api/integration/v1/org');
    expect(missing.statusCode).toBe(401);
    expect(missing.headers['content-type']).toContain('application/problem+json');
    expect(missing.json()).toMatchObject({ code: 'API_KEY_MISSING' });
    const invalid = await call(app, 'GET', '/api/integration/v1/org', undefined, 'vsm_bad');
    expect(invalid.json()).toMatchObject({ status: 401, code: 'API_KEY_INVALID' });
    const forbidden = await call(
      app,
      'PUT',
      `/api/integration/v1/employees/${extId}`,
      {
        role: 'CONDUCTOR',
        brigadeCode: '12',
        depotCode: 'MSK',
        position: 'Проводник',
        grade: 'TRAINEE',
      },
      narrowKey,
    );
    expect(forbidden.json()).toMatchObject({ status: 403, code: 'API_KEY_SCOPE' });
  });

  it('upsert идемпотентен и не хранит табельный номер', async () => {
    const url = `/api/integration/v1/employees/${extId}`;
    const first = await call(
      app,
      'PUT',
      url,
      {
        role: 'CONDUCTOR',
        brigadeCode: '12',
        depotCode: 'MSK',
        position: 'Проводник',
        grade: 'TRAINEE',
      },
      key,
    );
    expect(first.statusCode).toBe(200);
    const created = first.json() as {
      userId: string;
      login: string;
      callsign: string;
      created: boolean;
      password?: string;
    };
    expect(created.created).toBe(true);
    expect(created.password && created.password.length > 0).toBe(true);
    expect(created.callsign).toMatch(/^[A-Z0-9]{4}$/);
    const hash = extHashOf(extId, pepper);
    expect(created.login).toBe(loginFromExtHash(hash));
    expect(memory.users).toHaveLength(1);
    const stored = memory.users[0];
    expect(stored?.extHash).toBe(hash);
    expect(stored?.mustChangePassword).toBe(true);
    expect(stored?.passwordHash).not.toContain(created.password);
    expect(JSON.stringify(memory.dump())).not.toContain(extId);

    const second = await call(
      app,
      'PUT',
      url,
      {
        role: 'CHIEF',
        brigadeCode: '12',
        depotCode: 'MSK',
        position: 'Бригадир',
        grade: 'CONDUCTOR',
      },
      key,
    );
    const updated = second.json() as {
      userId: string;
      created: boolean;
      password?: string;
    };
    expect(updated).toEqual({
      userId: created.userId,
      login: created.login,
      callsign: created.callsign,
      created: false,
    });
    expect(memory.users).toHaveLength(1);
    expect(memory.users[0]?.passwordHash).toBe(stored?.passwordHash);
    expect(memory.users[0]?.position).toBe('Бригадир');
    expect(memory.users[0]?.role).toBe('CHIEF');
  });

  it('не принимает ФИО и неизвестное депо', async () => {
    const fio = await call(
      app,
      'PUT',
      '/api/integration/v1/employees/tab-other-1',
      {
        role: 'CONDUCTOR',
        brigadeCode: '12',
        depotCode: 'MSK',
        position: 'Проводник',
        grade: 'TRAINEE',
        fullName: 'Иван Иванов',
      },
      key,
    );
    expect(fio.statusCode).toBe(422);
    expect(fio.json()).toMatchObject({ code: 'VALIDATION' });
    expect(memory.users).toHaveLength(1);

    const missingDepot = await call(
      app,
      'PUT',
      '/api/integration/v1/employees/tab-other-2',
      {
        role: 'CONDUCTOR',
        brigadeCode: '12',
        depotCode: 'NOPE',
        position: 'Проводник',
        grade: 'TRAINEE',
      },
      key,
    );
    expect(missingDepot.json()).toMatchObject({ status: 404, code: 'DEPOT_NOT_FOUND' });
    expect(memory.users).toHaveLength(1);
  });

  it('отдаёт прогресс и оргструктуру', async () => {
    const progress = await call(
      app,
      'GET',
      `/api/integration/v1/employees/${extId}/progress`,
      undefined,
      key,
    );
    expect(progress.statusCode).toBe(200);
    expect(progress.json()).toMatchObject({
      callsign: memory.users[0]?.callsign,
      grade: 'CONDUCTOR',
      level: 1,
      points: 0,
      runs: { total: 0, completed: 0, incidents: 0, terminated: 0 },
      achievements: [],
      lastRunAt: null,
      promotion: null,
      competencies: {
        safety: 0,
        procedure: 0,
        detection: 0,
        reaction: 0,
        service: 0,
        escalation: 0,
      },
    });
    expect(JSON.stringify(progress.json())).not.toContain(extId);

    const org = await call(app, 'GET', '/api/integration/v1/org', undefined, key);
    expect(org.json()).toEqual({
      depots: [
        {
          code: 'MSK',
          name: 'Depot MSK',
          city: 'Москва',
          employeeCount: 1,
          brigades: [{ code: '12', name: 'Бригада 12', employeeCount: 1 }],
        },
      ],
    });
    const unknown = await call(
      app,
      'GET',
      '/api/integration/v1/employees/tab-missing/progress',
      undefined,
      key,
    );
    expect(unknown.json()).toMatchObject({ status: 404, code: 'EMPLOYEE_NOT_FOUND' });
  });

  it('подписывает вебхук один раз и не дублирует доставку', async () => {
    const issued = await call(app, 'POST', '/api/v1/admin/api-clients', {
      name: 'Вебхуки',
      scopes: ['webhooks:manage', 'employees:write'],
    });
    const hookKey = (issued.json() as { key: string }).key;
    const created = await call(
      app,
      'POST',
      '/api/integration/v1/webhooks',
      { url: 'https://lms.example/hook', events: ['run.recorded'] },
      hookKey,
    );
    expect(created.statusCode).toBe(201);
    const hook = created.json() as { id: string; secret: string };
    expect(hook.secret).toMatch(/^[0-9a-f]{64}$/);
    const listed = await call(app, 'GET', '/api/integration/v1/webhooks', undefined, hookKey);
    expect(JSON.stringify(listed.json())).not.toContain(hook.secret);

    const userId = memory.users[0]?.id ?? '';
    const runId = randomUUID();
    const payload = {
      runId,
      userId,
      brigadeId: null,
      depotId: null,
      points: 12,
      outcome: 'completed' as const,
      suspicious: false,
    };
    // emitAsync не ждёт обработчик @OnEvent в этой версии шины — зовём метод, который она вызывает.
    const dispatch = app.get(WebhookDispatchService);
    await dispatch.onRunRecorded(payload);
    await dispatch.onRunRecorded(payload);
    expect(memory.deliveries).toHaveLength(1);
    expect(JSON.stringify(memory.deliveries[0]?.payload)).not.toContain(extId);

    let signature = '';
    let timestamp = '';
    let body = '';
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
    await app.get(WebhookDispatchService).dispatch(new Date());
    vi.unstubAllGlobals();
    expect(verifyWebhook(hook.secret, timestamp, body, signature)).toBe(true);
    expect(JSON.parse(body)).toMatchObject({
      event: 'run.recorded',
      data: { userId, callsign: memory.users[0]?.callsign, points: 12 },
    });
    expect(memory.deliveries[0]?.status).toBe('SENT');

    const removed = await call(
      app,
      'DELETE',
      `/api/integration/v1/webhooks/${hook.id}`,
      undefined,
      hookKey,
    );
    expect(removed.statusCode).toBe(204);
    const again = await call(app, 'GET', '/api/integration/v1/webhooks', undefined, hookKey);
    expect(again.json()).toEqual([]);
  });

  it('отзыв ключа закрывает API', async () => {
    const clientId = memory.clients.find((client) => client.name === 'Кадры')?.id ?? '';
    const revoked = await call(app, 'POST', `/api/v1/admin/api-clients/${clientId}/revoke`);
    expect(revoked.statusCode).toBe(200);
    const again = await call(app, 'POST', `/api/v1/admin/api-clients/${clientId}/revoke`);
    expect(again.json()).toEqual(revoked.json());
    const denied = await call(app, 'GET', '/api/integration/v1/org', undefined, key);
    expect(denied.json()).toMatchObject({ status: 401, code: 'API_KEY_REVOKED' });
  });
});
