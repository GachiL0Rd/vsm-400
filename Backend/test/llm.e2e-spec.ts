import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { AccessGuard } from '../src/auth/access.guard';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';
import { testDatabaseUrl, testRedisUrl } from './databases';
import { HeaderAccessGuard } from './header-access.guard';

const actor: { id: string } = { id: '' };

describe('перефразы LLM', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl('llm');
    process.env.REDIS_URL = testRedisUrl('llm');
    process.env.LLM_PROVIDER = 'none';

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AccessGuard)
      .useClass(HeaderAccessGuard)
      .compile();
    app = moduleRef.createNestApplication(new FastifyAdapter({ bodyLimit: 1_048_576 }), {
      logger: false,
    });
    await configureApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    prisma = app.get(PrismaService);
    const user = await prisma.user.upsert({
      where: { login: 'llm-methodist' },
      update: { role: 'METHODIST' },
      create: {
        login: 'llm-methodist',
        passwordHash: 'hash-placeholder',
        role: 'METHODIST',
        callsign: 'L1M1',
        position: 'методист',
        grade: 'INSTRUCTOR',
      },
    });
    actor.id = user.id;
  }, 60_000);

  afterAll(async () => {
    if (prisma) {
      await prisma.scenarioTextVariant.deleteMany({ where: { model: 'e2e-model' } });
    }
    if (app) {
      await app.close();
    }
  });

  function inject(
    method: 'GET' | 'POST',
    url: string,
    role?: string,
    payload?: unknown,
  ): Promise<LightMyRequestResponse> {
    return app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method,
        url,
        headers: role ? { 'x-test-role': role, 'x-test-actor': actor.id } : {},
        payload: payload as never,
      });
  }

  it('закрывает ручки без сессии и от проводника', async () => {
    const anon = await inject('GET', '/api/v1/admin/llm/status');
    expect(anon.statusCode).toBe(401);
    expect(anon.json()).toMatchObject({ code: 'UNAUTHENTICATED' });

    const denied = await inject(
      'GET',
      '/api/v1/admin/scenarios/ride-pressure/variants',
      'CONDUCTOR',
    );
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('показывает статус выключенного провайдера', async () => {
    const response = await inject('GET', '/api/v1/admin/llm/status', 'ADMIN');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      provider: 'none',
      queue: { waiting: expect.any(Number), active: expect.any(Number) },
      rejected: expect.any(Number),
      retries: { generation: expect.any(Number), judge: expect.any(Number) },
      pool: expect.any(Array),
      errors: expect.any(Array),
    });
  });

  it('одобряет и отклоняет вариант, generate при none — 409', async () => {
    const missing = await inject('GET', '/api/v1/admin/scenarios/no-such/variants', 'METHODIST');
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ code: 'NOT_FOUND' });

    const scenario = await prisma.scenario.findUniqueOrThrow({ where: { id: 'ride-pressure' } });
    const pending = await prisma.scenarioTextVariant.create({
      data: {
        scenarioId: 'ride-pressure',
        version: scenario.currentVersion,
        nodeId: 'open',
        persona: 'тест',
        promptVersion: 'e2e',
        model: 'e2e-model',
        payload: {
          text: 'Из тамбура свистит.',
          choices: [{ id: 'radio', text: 'Доложить' }],
        },
        status: 'PENDING_REVIEW',
        maxUses: 5,
      },
    });
    const rejected = await prisma.scenarioTextVariant.create({
      data: {
        scenarioId: 'ride-pressure',
        version: scenario.currentVersion,
        nodeId: 'follow',
        persona: 'тест',
        promptVersion: 'e2e',
        model: 'e2e-model',
        payload: { text: 'Люди у двери.', choices: [] },
        status: 'PENDING_REVIEW',
        maxUses: 5,
      },
    });

    const listed = await inject(
      'GET',
      '/api/v1/admin/scenarios/ride-pressure/variants?status=PENDING_REVIEW&nodeId=open',
      'METHODIST',
    );
    expect(listed.statusCode).toBe(200);
    const items = (listed.json() as { items: { id: string }[] }).items;
    expect(items.map((item) => item.id)).toContain(pending.id);
    expect(items.map((item) => item.id)).not.toContain(rejected.id);

    const approved = await inject(
      'POST',
      `/api/v1/admin/scenarios/ride-pressure/variants/${pending.id}/approve`,
      'ADMIN',
    );
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toMatchObject({ id: pending.id, status: 'APPROVED' });

    const again = await inject(
      'POST',
      `/api/v1/admin/scenarios/ride-pressure/variants/${pending.id}/approve`,
      'ADMIN',
    );
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ code: 'CONFLICT' });

    const badReason = await inject(
      'POST',
      `/api/v1/admin/scenarios/ride-pressure/variants/${rejected.id}/reject`,
      'METHODIST',
      {},
    );
    expect(badReason.statusCode).toBe(422);

    const reject = await inject(
      'POST',
      `/api/v1/admin/scenarios/ride-pressure/variants/${rejected.id}/reject`,
      'METHODIST',
      { reason: 'смысл уехал' },
    );
    expect(reject.statusCode).toBe(200);
    expect(reject.json()).toMatchObject({ status: 'REJECTED', rejectReason: 'смысл уехал' });

    const unknown = await inject(
      'POST',
      '/api/v1/admin/scenarios/ride-pressure/variants/00000000-0000-7000-8000-000000000099/approve',
      'ADMIN',
    );
    expect(unknown.statusCode).toBe(404);

    const generate = await inject(
      'POST',
      '/api/v1/admin/scenarios/ride-pressure/variants/generate',
      'METHODIST',
      { nodeId: 'open', count: 1 },
    );
    expect(generate.statusCode).toBe(409);
    expect(generate.json()).toMatchObject({ code: 'LLM_DISABLED' });

    const tooMany = await inject(
      'POST',
      '/api/v1/admin/scenarios/ride-pressure/variants/generate',
      'METHODIST',
      { count: 21 },
    );
    expect(tooMany.statusCode).toBe(422);
  });
});
