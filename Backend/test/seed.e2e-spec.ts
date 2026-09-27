import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resetDomain } from '../prisma/seed/reset';
import { runSeed } from '../prisma/seed/run-seed';
import { AppModule } from '../src/app.module';
import { APP_CONFIG, loadConfig } from '../src/config/env';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';
import { payloadSha256 } from '../src/sessions/canonical-json';
import type { FinishedGameResult } from '../src/sessions/platform.dto';
import { testDatabaseUrl, testRedisUrl } from './databases';

describe('сид из результатов игры', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const databaseUrl = testDatabaseUrl('seed');
    const database = new URL(databaseUrl).pathname.slice(1);
    if (database === 'vsm' || !database.endsWith('seed')) {
      throw new Error(`Сид-тест отказался чистить базу ${database}`);
    }
    const redisUrl = testRedisUrl('seed');
    process.env.DATABASE_URL = databaseUrl;
    process.env.REDIS_URL = redisUrl;
    await resetDomain();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG)
      .useValue(loadConfig({ ...process.env, DATABASE_URL: databaseUrl, REDIS_URL: redisUrl }))
      .compile();
    app = moduleRef.createNestApplication(new FastifyAdapter());
    await configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    expect(await runSeed(app)).toBe('wrote');
    expect(await runSeed(app)).toBe('skipped');
  }, 180_000);

  afterAll(async () => {
    await app?.close();
  });

  it('заводит пять проводников одной бригады и решения из фактов', async () => {
    const depots = await prisma.depot.count();
    const brigades = await prisma.brigade.count();
    const conductors = await prisma.user.findMany({
      where: { login: { in: ['demo1', 'demo2', 'demo3', 'demo4', 'demo5'] } },
      select: {
        id: true,
        login: true,
        role: true,
        brigadeId: true,
        _count: { select: { runs: true } },
      },
    });
    expect(depots).toBe(1);
    expect(brigades).toBe(1);
    expect(conductors).toHaveLength(5);
    expect(new Set(conductors.map((user) => user.brigadeId)).size).toBe(1);
    expect(conductors.every((user) => user.role === 'CONDUCTOR')).toBe(true);
    expect(conductors.map((user) => user._count.runs).sort((left, right) => left - right)).toEqual([
      4, 12, 12, 14, 16,
    ]);
    const staff = await prisma.user.count({ where: { role: { in: ['CHIEF', 'METHODIST'] } } });
    expect(staff).toBe(0);

    const run = await prisma.run.findFirst({
      where: { user: { login: 'demo2' } },
      include: { decisions: { orderBy: { idx: 'asc' } }, session: true },
    });
    expect(run).toBeTruthy();
    if (!run) {
      return;
    }
    expect(run.session.transport).toBe('WS');
    expect(run.session.status).toBe('COMPLETED');
    const stored = readPlatform(run.session.result);
    expect(stored.body.attemptId).toBe(run.session.id);
    expect(stored.hash).toBe(payloadSha256(stored.body));
    const facts = stored.body.assessment?.facts ?? [];
    expect(run.decisions.map((decision) => decision.nodeId)).toEqual(facts.map((fact) => fact.id));
    expect(run.decisions.map((decision) => decision.choiceId)).toEqual(
      facts.map((fact) => fact.kind),
    );
    expect(facts.length).toBeGreaterThan(0);
  });
});

function readPlatform(raw: unknown): { hash: string; body: FinishedGameResult } {
  if (!raw || typeof raw !== 'object' || !('platform' in raw)) {
    throw new Error('В сессии нет platform');
  }
  const platform = raw.platform;
  if (
    !platform ||
    typeof platform !== 'object' ||
    !('payloadSha256' in platform) ||
    !('result' in platform)
  ) {
    throw new Error('platform без хеша или тела');
  }
  const hash = platform.payloadSha256;
  const body = platform.result;
  if (typeof hash !== 'string' || !body || typeof body !== 'object') {
    throw new Error('platform битый');
  }
  return { hash, body: body as FinishedGameResult };
}
