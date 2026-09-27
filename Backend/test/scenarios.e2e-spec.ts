import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { AccessGuard } from '../src/auth/access.guard';
import { configureApp } from '../src/configure-app';
import type { ScenarioGraph } from '../src/engine/schema';
import { PrismaService } from '../src/prisma/prisma.service';
import { graphChecksum } from '../src/scenarios/checksum';
import { loadScenarioGraphs } from '../src/scenarios/load-content';
import { ScenariosService } from '../src/scenarios/scenarios.service';
import { testDatabaseUrl, testRedisUrl } from './databases';
import { HeaderAccessGuard } from './header-access.guard';

function createFastifyAdapter(): FastifyAdapter {
  return new FastifyAdapter({ bodyLimit: 1_048_576 });
}

const actor: { id: string } = { id: '' };

describe('сценарии', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let scenarios: ScenariosService;

  beforeAll(async () => {
    // Своя база: кабинет в том же прогоне пишет сценарии в vsm_cabinet.
    process.env.DATABASE_URL = testDatabaseUrl('scenarios');
    process.env.REDIS_URL = testRedisUrl('scenarios');

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AccessGuard)
      .useClass(HeaderAccessGuard)
      .compile();

    app = moduleRef.createNestApplication(createFastifyAdapter(), { logger: false });
    await configureApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    prisma = app.get(PrismaService);
    scenarios = app.get(ScenariosService);
    const user = await prisma.user.upsert({
      where: { login: 'scenarios-methodist' },
      update: { role: 'METHODIST' },
      create: {
        login: 'scenarios-methodist',
        passwordHash: 'hash-placeholder',
        role: 'METHODIST',
        callsign: 'S9C1',
        position: 'методист',
        grade: 'INSTRUCTOR',
      },
    });
    actor.id = user.id;
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  function inject(
    method: 'GET' | 'PUT' | 'POST',
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

  it('повторный sync не создаёт версий', async () => {
    const before = await prisma.scenarioVersion.count();
    const stats = await scenarios.syncFromContent();
    const after = await prisma.scenarioVersion.count();
    expect(stats.createdVersions).toBe(0);
    expect(after).toBe(before);
    expect(stats.scenarios).toBeGreaterThanOrEqual(10);
  });

  it('каталог без графа для любого залогиненного', async () => {
    const anon = await inject('GET', '/api/v1/scenarios');
    expect(anon.statusCode).toBe(401);

    const response = await inject('GET', '/api/v1/scenarios', 'CONDUCTOR');
    expect(response.statusCode).toBe(200);
    const body = response.json() as Record<string, unknown>[];
    expect(body.length).toBeGreaterThanOrEqual(10);
    expect(body[0]).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        title: expect.any(String),
        category: expect.any(String),
        carClasses: expect.any(Array),
        difficulty: expect.any(Number),
        competencies: expect.any(Array),
        version: expect.any(Number),
        stage: expect.any(String),
      }),
    );
    expect(body[0]).not.toHaveProperty('graph');
  });

  it('неизвестный сценарий — 404 NOT_FOUND', async () => {
    const missing = await inject('GET', '/api/v1/scenarios/no-such-scenario', 'METHODIST');
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ code: 'NOT_FOUND', detail: 'Сценарий не найден' });

    const status = await inject(
      'POST',
      '/api/v1/admin/scenarios/no-such-scenario/status',
      'ADMIN',
      {
        status: 'DRAFT',
      },
    );
    expect(status.statusCode).toBe(404);
    expect(status.json()).toMatchObject({ code: 'NOT_FOUND', detail: 'Сценарий не найден' });
  });

  it('граф только у методиста и администратора', async () => {
    const list = (await inject('GET', '/api/v1/scenarios', 'CONDUCTOR')).json() as {
      id: string;
    }[];
    const id = list[0]?.id;
    expect(id).toBeTruthy();
    const denied = await inject('GET', `/api/v1/scenarios/${id}`, 'CONDUCTOR');
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ code: 'FORBIDDEN' });

    const allowed = await inject('GET', `/api/v1/scenarios/${id}`, 'METHODIST');
    expect(allowed.statusCode).toBe(200);
    const detail = allowed.json() as { graph: ScenarioGraph; version: number };
    expect(detail.graph.nodes).toBeTruthy();
    expect(detail.graph.id).toBe(id);
    expect(detail.version).toBeGreaterThan(0);
  });

  it('PUT создаёт версию, кривой граф — 422 и не пишет', async () => {
    const current = (await inject('GET', '/api/v1/scenarios/accept-kit-fault', 'ADMIN')).json() as {
      version: number;
      graph: ScenarioGraph;
    };
    const before = await prisma.scenarioVersion.count({
      where: { scenarioId: 'accept-kit-fault' },
    });
    const saved = await inject('PUT', '/api/v1/admin/scenarios/accept-kit-fault', 'METHODIST', {
      ...current.graph,
      title: `${current.graph.title} ред`,
    });
    expect(saved.statusCode).toBe(200);
    const body = saved.json() as { version: number; title: string; graph: ScenarioGraph };
    expect(body.version).toBe(current.version + 1);
    expect(body.graph.title).toContain('ред');
    const after = await prisma.scenarioVersion.count({ where: { scenarioId: 'accept-kit-fault' } });
    expect(after).toBe(before + 1);

    const forbidden = await inject(
      'PUT',
      '/api/v1/admin/scenarios/accept-kit-fault',
      'CONDUCTOR',
      current.graph,
    );
    expect(forbidden.statusCode).toBe(403);

    const invalid = await inject('PUT', '/api/v1/admin/scenarios/accept-kit-fault', 'ADMIN', {
      id: 'accept-kit-fault',
    });
    expect(invalid.statusCode).toBe(422);
    expect(invalid.headers['content-type']).toContain('application/problem+json');
    const problem = invalid.json() as { errors?: unknown[]; code: string };
    expect(problem.code).toBe('VALIDATION');
    expect(problem.errors?.length).toBeGreaterThan(0);
    const still = await prisma.scenarioVersion.count({ where: { scenarioId: 'accept-kit-fault' } });
    expect(still).toBe(after);

    const mismatch = await inject('PUT', '/api/v1/admin/scenarios/accept-kit-fault', 'ADMIN', {
      ...current.graph,
      id: 'other-scenario',
    });
    expect(mismatch.statusCode).toBe(422);
    const mismatchBody = mismatch.json() as { errors?: { path: string }[] };
    expect(mismatchBody.errors?.some((issue) => issue.path === 'id')).toBe(true);
  });

  it('статус прячет сценарий из каталога', async () => {
    const hidden = await inject('POST', '/api/v1/admin/scenarios/hand-left-bag/status', 'ADMIN', {
      status: 'ARCHIVED',
    });
    expect(hidden.statusCode).toBe(200);
    expect(hidden.json()).toMatchObject({ id: 'hand-left-bag', status: 'ARCHIVED' });
    const catalog = (await inject('GET', '/api/v1/scenarios', 'CHIEF')).json() as { id: string }[];
    expect(catalog.some((item) => item.id === 'hand-left-bag')).toBe(false);

    const back = await inject('POST', '/api/v1/admin/scenarios/hand-left-bag/status', 'METHODIST', {
      status: 'PUBLISHED',
    });
    expect(back.statusCode).toBe(200);
    const restored = (await inject('GET', '/api/v1/scenarios', 'CONDUCTOR')).json() as {
      id: string;
    }[];
    expect(restored.some((item) => item.id === 'hand-left-bag')).toBe(true);

    const bad = await inject('POST', '/api/v1/admin/scenarios/hand-left-bag/status', 'ADMIN', {
      status: 'LIVE',
    });
    expect(bad.statusCode).toBe(422);
  });

  it('правка методиста переживает повторный syncFromContent', async () => {
    const id = 'ride-smoke-sensor';
    const current = (await inject('GET', `/api/v1/scenarios/${id}`, 'ADMIN')).json() as {
      version: number;
      graph: ScenarioGraph;
    };
    const title = `${current.graph.title} правка`;
    const saved = await inject('PUT', `/api/v1/admin/scenarios/${id}`, 'METHODIST', {
      ...current.graph,
      title,
    });
    expect(saved.statusCode).toBe(200);
    const body = saved.json() as { version: number; title: string };
    expect(body.version).toBe(current.version + 1);
    expect(body.title).toBe(title);

    const before = await prisma.scenarioVersion.count();
    const stats = await scenarios.syncFromContent();
    expect(stats.createdVersions).toBe(0);
    expect(await prisma.scenarioVersion.count()).toBe(before);

    const again = (await inject('GET', `/api/v1/scenarios/${id}`, 'METHODIST')).json() as {
      version: number;
      title: string;
      status: string;
    };
    expect(again.version).toBe(body.version);
    expect(again.title).toBe(title);
    expect(again.status).toBe('PUBLISHED');
    const tip = await prisma.scenarioVersion.findFirst({
      where: { scenarioId: id },
      orderBy: { version: 'desc' },
      select: { version: true, createdById: true },
    });
    expect(tip).toEqual({ version: body.version, createdById: actor.id });
  });

  it('ARCHIVED и DRAFT переживают syncFromContent', async () => {
    const archivedId = 'board-pet-carrier';
    const draftId = 'stop-late-exit';
    try {
      expect(
        (
          await inject('POST', `/api/v1/admin/scenarios/${archivedId}/status`, 'ADMIN', {
            status: 'ARCHIVED',
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await inject('POST', `/api/v1/admin/scenarios/${draftId}/status`, 'METHODIST', {
            status: 'DRAFT',
          })
        ).statusCode,
      ).toBe(200);

      const stats = await scenarios.syncFromContent();
      expect(stats.createdVersions).toBe(0);
      expect((await prisma.scenario.findUnique({ where: { id: archivedId } }))?.status).toBe(
        'ARCHIVED',
      );
      expect((await prisma.scenario.findUnique({ where: { id: draftId } }))?.status).toBe('DRAFT');

      const catalog = (await inject('GET', '/api/v1/scenarios', 'CHIEF')).json() as {
        id: string;
      }[];
      expect(catalog.some((item) => item.id === archivedId || item.id === draftId)).toBe(false);
    } finally {
      await inject('POST', `/api/v1/admin/scenarios/${archivedId}/status`, 'ADMIN', {
        status: 'PUBLISHED',
      });
      await inject('POST', `/api/v1/admin/scenarios/${draftId}/status`, 'ADMIN', {
        status: 'PUBLISHED',
      });
    }
  });

  it('файл без правок не создаёт версию', async () => {
    const id = 'board-wrong-train';
    const before = await prisma.scenarioVersion.count({ where: { scenarioId: id } });
    const totalBefore = await prisma.scenarioVersion.count();
    const stats = await scenarios.syncFromContent();
    expect(stats.createdVersions).toBe(0);
    expect(await prisma.scenarioVersion.count({ where: { scenarioId: id } })).toBe(before);
    expect(await prisma.scenarioVersion.count()).toBe(totalBefore);
  });

  it('PUT графа как в файле снова отдаёт хвост файлу', async () => {
    const id = 'ride-drunk';
    const file = loadScenarioGraphs().find((item) => item.id === id);
    expect(file).toBeTruthy();
    if (!file) {
      return;
    }
    const current = (await inject('GET', `/api/v1/scenarios/${id}`, 'ADMIN')).json() as {
      graph: ScenarioGraph;
    };
    const edited = await inject('PUT', `/api/v1/admin/scenarios/${id}`, 'METHODIST', {
      ...current.graph,
      title: `${current.graph.title} временно`,
    });
    expect(edited.statusCode).toBe(200);

    const adopted = await inject('PUT', `/api/v1/admin/scenarios/${id}`, 'ADMIN', file);
    expect(adopted.statusCode).toBe(200);
    const body = adopted.json() as { version: number; title: string };
    expect(body.title).toBe(file.title);
    const row = await prisma.scenarioVersion.findUnique({
      where: { scenarioId_version: { scenarioId: id, version: body.version } },
      select: { createdById: true, checksum: true },
    });
    expect(row?.createdById).toBeNull();
    expect(row?.checksum).toBe(graphChecksum(file));

    const stats = await scenarios.syncFromContent();
    expect(stats.createdVersions).toBe(0);
  });
});
