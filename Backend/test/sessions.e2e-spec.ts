import { EventEmitter2 } from '@nestjs/event-emitter';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { LightMyRequestResponse } from 'fastify';
import Redis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { AccessGuard } from '../src/auth/access.guard';
import { Clock } from '../src/common/clock';
import {
  RUN_COMPLETED,
  type RunCompletedPayload,
  SESSION_TEXT_REQUESTED,
  type SessionTextRequestedPayload,
} from '../src/common/events';
import { APP_CONFIG, type AppConfig, loadConfig } from '../src/config/env';
import { configureApp } from '../src/configure-app';
import { commitOf, createRng } from '../src/engine/rng';
import type { ScenarioGraph } from '../src/engine/schema';
import { PrismaService } from '../src/prisma/prisma.service';
import { ScenariosService } from '../src/scenarios/scenarios.service';
import type { OpenedSession } from '../src/sessions/dto';
import { decryptSeed } from '../src/sessions/seed-box';
import { SessionsService } from '../src/sessions/sessions.service';
import { personaOf, pickApprovedId, readTextPlan, textPlanKey } from '../src/sessions/text-plan';
import { randomCallsign } from '../src/users/callsign';
import { testDatabaseUrl, testRedisUrl } from './databases';
import { HeaderAccessGuard } from './header-access.guard';

function linear(
  id: string,
  title: string,
  stage: ScenarioGraph['stage'],
  timer: number,
): ScenarioGraph {
  return {
    id,
    title,
    category: 'service',
    stage,
    carClasses: ['ECONOMY'],
    difficulty: 1,
    competencies: ['service'],
    init: { loyalty: 60, safety: 60 },
    start: 'n1',
    nodes: {
      n1: {
        text: title,
        timer,
        choices: [
          {
            id: 'do',
            text: 'Сделать по регламенту',
            effects: { safety: 5, loyalty: 5 },
            skills: { service: 1 },
            verdict: 'best',
            next: 'end',
          },
          {
            id: 'skip',
            text: 'Пропустить',
            effects: { safety: -5 },
            verdict: 'worse',
            next: 'end',
          },
        ],
        onTimeout: {
          effects: { safety: -5, loyalty: -5 },
          verdict: 'missed',
          next: 'end',
        },
      },
      end: { end: 'completed', text: 'Готово' },
    },
  };
}

function llmGraph(id: string, nodeId: string, mode: 'pool' | 'live'): ScenarioGraph {
  return {
    id,
    title: id,
    category: 'service',
    stage: 'acceptance',
    carClasses: ['ECONOMY'],
    difficulty: 1,
    competencies: ['service'],
    init: { loyalty: 60, safety: 60 },
    llm: {
      enabled: true,
      mode,
      personas: ['тихий', 'раздражённый'],
    },
    start: nodeId,
    nodes: {
      [nodeId]: {
        text: 'Исходная ситуация',
        timer: 30,
        choices: [
          {
            id: 'do',
            text: 'Сделать по регламенту',
            effects: { safety: 5, loyalty: 5 },
            skills: { service: 1 },
            verdict: 'best',
            next: 'end',
          },
          {
            id: 'skip',
            text: 'Пропустить',
            effects: { safety: -5 },
            verdict: 'worse',
            next: 'end',
          },
        ],
        onTimeout: {
          effects: { safety: -5, loyalty: -5 },
          verdict: 'missed',
          next: 'end',
        },
      },
      end: { end: 'completed', text: 'Готово' },
    },
  };
}

const llmPool = llmGraph('sess-llm', 'pool-ask', 'pool');
const llmLive = llmGraph('sess-live', 'live-ask', 'live');

const fixtureGraphs = [
  linear('sess-accept', 'Приёмка', 'acceptance', 20),
  linear('sess-ride', 'Перегон', 'enroute', 15),
  linear('sess-hand', 'Сдача', 'handover', 12),
  llmPool,
  llmLive,
];

const fixtureScenarios = {
  async getCatalog() {
    return fixtureGraphs.map((graph) => ({
      id: graph.id,
      title: graph.title,
      category: graph.category,
      carClasses: graph.carClasses,
      difficulty: graph.difficulty,
      competencies: graph.competencies,
      version: 1,
      stage: graph.stage,
    }));
  },
  async getVersion(id: string, version: number) {
    const graph = fixtureGraphs.find((item) => item.id === id && version === 1);
    if (!graph) {
      throw new Error('Версия сценария не найдена');
    }
    return { scenarioId: id, version: 1, checksum: 'fixture', graph };
  },
};

class ManualClock extends Clock {
  current = new Date('2020-01-01T00:00:00.000Z');

  now(): Date {
    return new Date(this.current.getTime());
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

function ticketPayload(token: string): { jti: string } {
  const part = token.split('.')[1] ?? '';
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as { jti: string };
}

function finishBody(attemptId: string, loyalty = 87) {
  return {
    attemptId,
    content: {
      gameLevelId: 'level-1',
      gameLevelVersion: '1',
      simulationCompatibilityVersion: '1',
    },
    rootSeed: 'root-seed',
    userInputs: [],
    achievements: { setVersion: '1', ids: [] as string[] },
    termination: { kind: 'route-completed' as const, outcomeId: 'arrived' },
    scores: { safety: 89, customerSatisfaction: loyalty },
  };
}

function bearer(): Record<string, string> {
  return { authorization: `Bearer ${process.env.GAME_SERVER_TOKEN ?? ''}` };
}

describe('игровые сессии', () => {
  const clock = new ManualClock();
  const userIds: string[] = [];
  const completed: RunCompletedPayload[] = [];
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let config: AppConfig;
  let redisUrl = '';

  beforeAll(async () => {
    redisUrl = testRedisUrl('sessions');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG)
      .useValue(
        loadConfig({
          ...process.env,
          DATABASE_URL: testDatabaseUrl('sessions'),
          REDIS_URL: redisUrl,
        }),
      )
      .overrideProvider(AccessGuard)
      .useClass(HeaderAccessGuard)
      .overrideProvider(Clock)
      .useValue(clock)
      .overrideProvider(ScenariosService)
      .useValue(fixtureScenarios)
      .compile();
    app = moduleRef.createNestApplication(new FastifyAdapter({ bodyLimit: 1_048_576 }), {
      logger: false,
    });
    await configureApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    prisma = app.get(PrismaService);
    config = app.get(APP_CONFIG);
    app.get(EventEmitter2).on(RUN_COMPLETED, (payload: RunCompletedPayload) => {
      completed.push(payload);
    });
  }, 60_000);

  afterAll(async () => {
    await wipe(prisma, userIds);
    await prisma.scenarioTextVariant.deleteMany({
      where: { scenarioId: { in: ['sess-llm', 'sess-live'] } },
    });
    await prisma.scenarioVersion.deleteMany({
      where: { scenarioId: { in: ['sess-llm', 'sess-live'] } },
    });
    await prisma.scenario.deleteMany({ where: { id: { in: ['sess-llm', 'sess-live'] } } });
    const redis = new Redis(redisUrl);
    const keys = await redis.keys('vsm:ticket:*');
    if (keys.length > 0) {
      await redis.del(...keys);
    }
    await redis.quit();
    await app.close();
  });

  async function makeUser(prefix: string): Promise<{ id: string; callsign: string }> {
    const sign = randomCallsign();
    const user = await prisma.user.create({
      data: {
        login: `sess-${prefix}-${sign}`,
        passwordHash: 'hash',
        role: 'CONDUCTOR',
        callsign: sign,
        position: 'проводник',
        grade: 'TRAINEE',
      },
    });
    userIds.push(user.id);
    return user;
  }

  function inject(
    method: 'GET' | 'POST',
    url: string,
    actor?: string,
    payload?: unknown,
    extra?: Record<string, string>,
  ): Promise<LightMyRequestResponse> {
    const headers: Record<string, string> = { ...extra };
    if (payload !== undefined) {
      headers['content-type'] = 'application/json';
    }
    if (actor) {
      headers['x-test-role'] = 'CONDUCTOR';
      headers['x-test-actor'] = actor;
    }
    return app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method,
        url,
        headers,
        payload: payload === undefined ? undefined : JSON.stringify(payload),
      });
  }

  async function assignScenario(userId: string, scenarioId: string): Promise<void> {
    await prisma.shiftAssignment.create({
      data: {
        userId,
        train: 'ВСМ 701',
        fromStation: 'Москва',
        toStation: 'Санкт-Петербург',
        stops: [],
        car: 1,
        carClass: 'ECONOMY',
        departureAt: new Date('2020-06-01T06:20:00.000Z'),
        focus: [],
        scenarioIds: [scenarioId],
        status: 'PLANNED',
      },
    });
  }

  async function resetLlm(id: string, title: string): Promise<void> {
    await prisma.scenarioTextVariant.deleteMany({ where: { scenarioId: id } });
    await prisma.scenarioVersion.deleteMany({ where: { scenarioId: id } });
    await prisma.scenario.deleteMany({ where: { id } });
    await prisma.scenario.create({
      data: {
        id,
        title,
        category: 'service',
        carClasses: ['ECONOMY'],
        difficulty: 1,
        competencies: ['service'],
        status: 'PUBLISHED',
        currentVersion: 1,
        versions: { create: { version: 1, graph: {}, checksum: 'llm-play' } },
      },
    });
  }

  async function putVariant(input: {
    id: string;
    scenarioId: string;
    nodeId: string;
    persona: string;
    text: string;
    doText: string;
    skipText: string;
    status?: 'APPROVED' | 'PENDING_REVIEW';
    maxUses?: number;
    createdAt?: Date;
    sessionId?: string;
  }): Promise<void> {
    await prisma.scenarioTextVariant.create({
      data: {
        id: input.id,
        scenarioId: input.scenarioId,
        version: 1,
        nodeId: input.nodeId,
        persona: input.persona,
        promptVersion: 'test',
        model: 'none',
        payload: {
          text: input.text,
          choices: [
            { id: 'do', text: input.doText },
            { id: 'skip', text: input.skipText },
          ],
        },
        status: input.status ?? 'APPROVED',
        maxUses: input.maxUses ?? 20,
        reason: input.sessionId ? 'LIVE' : 'SEED',
        sessionId: input.sessionId ?? null,
        ...(input.createdAt ? { createdAt: input.createdAt } : {}),
      },
    });
  }

  async function open(
    userId: string,
    body: { carClass?: 'ECONOMY' } = {},
  ): Promise<{ response: LightMyRequestResponse; body: OpenedSession }> {
    const response = await inject('POST', '/api/v1/game-sessions', userId, body);
    expect(response.statusCode).toBe(200);
    return { response, body: response.json() as OpenedSession };
  }

  it('создаёт одну смену, шифрует seed и помечает назначение', async () => {
    const user = await makeUser('open');
    const assignment = await prisma.shiftAssignment.create({
      data: {
        userId: user.id,
        train: 'ВСМ 707',
        fromStation: 'Москва',
        toStation: 'Санкт-Петербург',
        stops: ['Тверь'],
        car: 4,
        carClass: 'BUSINESS',
        departureAt: new Date('2020-01-02T06:30:00.000Z'),
        focus: ['safety'],
        scenarioIds: [],
        status: 'PLANNED',
      },
    });
    const rejected = await inject('POST', '/api/v1/game-sessions', user.id, { transport: 'REST' });
    expect(rejected.statusCode).toBe(422);

    const first = await open(user.id, { carClass: 'ECONOMY' });
    expect(first.body.wsUrl).toBe(config.publicGameWsUrl);
    expect(first.body.plan.segments).toBeGreaterThan(0);
    expect(first.body.plan.titles.length).toBe(first.body.plan.segments);
    expect(first.body.plan.carClass).toBe('ECONOMY');
    const row = await prisma.gameSession.findUniqueOrThrow({ where: { id: first.body.sessionId } });
    expect(row.status).toBe('PENDING');
    expect(row.transport).toBe('WS');
    expect(row.startedAt).toBeNull();
    expect(row.shiftId).toBe(assignment.id);
    expect(row.seedEnc).not.toBe(row.seedCommit);
    expect(row.seedEnc.includes(row.seedCommit)).toBe(false);
    const seed = decryptSeed(row.seedEnc, config.seedEncKey);
    expect(commitOf(seed)).toBe(row.seedCommit);
    expect(seed.toString('hex')).not.toBe(row.seedEnc);
    const started = await prisma.shiftAssignment.findUniqueOrThrow({
      where: { id: assignment.id },
    });
    expect(started.status).toBe('STARTED');

    const anon = await inject('POST', '/api/v1/game-sessions', undefined, {});
    expect(anon.statusCode).toBe(401);

    const second = await open(user.id);
    expect(second.body.sessionId).toBe(first.body.sessionId);
    expect(second.body.seedCommit).toBe(first.body.seedCommit);
    const flagged = await prisma.gameSession.findUniqueOrThrow({ where: { id: row.id } });
    expect(flagged.flags).not.toContain('multi-session');
    const resumed = await prisma.auditLog.count({
      where: { target: row.id, action: 'session.resumed' },
    });
    expect(resumed).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: { target: row.id, action: 'anticheat.multi-session' },
      }),
    ).toBe(0);
  });

  it('повторный open не метит рейс', async () => {
    const user = await makeUser('resume');
    const opened = await open(user.id);
    const again = await open(user.id);
    expect(again.body.sessionId).toBe(opened.body.sessionId);
    const verified = await inject(
      'POST',
      '/api/game/sessions/resolve',
      undefined,
      { key: again.body.ticket },
      bearer(),
    );
    expect(verified.statusCode, verified.body).toBe(200);
    const reported = await inject(
      'POST',
      `/api/game/sessions/${opened.body.sessionId}/finish`,
      undefined,
      finishBody(opened.body.sessionId),
      bearer(),
    );
    expect(reported.statusCode, reported.body).toBe(200);
    const mine = completed.filter((event) => event.sessionId === opened.body.sessionId);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.suspicious).toBe(false);
    const run = await prisma.run.findUniqueOrThrow({
      where: { sessionId: opened.body.sessionId },
    });
    expect(run.suspicious).toBe(false);
    const row = await prisma.gameSession.findUniqueOrThrow({
      where: { id: opened.body.sessionId },
    });
    expect(row.flags).toEqual([]);
  });

  it('чужая смена — 404', async () => {
    const owner = await makeUser('owner');
    const other = await makeUser('other');
    const opened = await open(owner.id);
    const response = await inject(
      'POST',
      `/api/v1/game-sessions/${opened.body.sessionId}/abort`,
      other.id,
    );
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: 'NOT_FOUND' });
    const missing = await inject('GET', `/api/v1/game-sessions/${opened.body.sessionId}`, owner.id);
    expect(missing.statusCode).toBe(404);
  });

  it('билет одноразовый и переводит PENDING в ACTIVE', async () => {
    const user = await makeUser('ticket');
    const opened = await open(user.id);
    const pending = await prisma.gameSession.findUniqueOrThrow({
      where: { id: opened.body.sessionId },
    });
    expect(pending.status).toBe('PENDING');
    const looked = await inject('GET', `/api/v1/game-sessions/${opened.body.sessionId}`, user.id);
    expect(looked.statusCode).toBe(404);
    const stillPending = await prisma.gameSession.findUniqueOrThrow({
      where: { id: opened.body.sessionId },
    });
    expect(stillPending.status).toBe('PENDING');
    const denied = await inject('POST', '/api/game/sessions/resolve', undefined, {
      key: opened.body.ticket,
    });
    expect(denied.statusCode).toBe(401);

    const verified = await inject(
      'POST',
      '/api/game/sessions/resolve',
      undefined,
      { key: opened.body.ticket },
      bearer(),
    );
    expect(verified.statusCode, verified.body).toBe(200);
    expect(verified.json()).toMatchObject({
      contractVersion: 1,
      attemptId: opened.body.sessionId,
      mode: { kind: 'guided' },
    });
    const active = await prisma.gameSession.findUniqueOrThrow({
      where: { id: opened.body.sessionId },
    });
    expect(active.status).toBe('ACTIVE');
    const redis = new Redis(redisUrl);
    expect(await redis.get(`vsm:ticket:${ticketPayload(opened.body.ticket).jti}`)).toBe('1');
    await redis.quit();

    const reused = await inject(
      'POST',
      '/api/game/sessions/resolve',
      undefined,
      { key: opened.body.ticket },
      bearer(),
    );
    expect(reused.statusCode).toBe(410);
    expect(reused.json()).toMatchObject({ code: 'session-consumed' });
    const flagged = await prisma.gameSession.findUniqueOrThrow({
      where: { id: opened.body.sessionId },
    });
    expect(flagged.flags).toContain('ticket-reused');

    const garbage = await inject(
      'POST',
      '/api/game/sessions/resolve',
      undefined,
      { key: 'not-a-jwt' },
      bearer(),
    );
    expect(garbage.statusCode).toBe(404);
    expect(garbage.json()).toMatchObject({ code: 'invalid-session' });
  });

  it('finish пишет рейс и повтор того же тела отдаёт тот же resultId', async () => {
    const user = await makeUser('report');
    const opened = await open(user.id);
    const id = opened.body.sessionId;
    const resolved = await inject(
      'POST',
      '/api/game/sessions/resolve',
      undefined,
      { key: opened.body.ticket },
      bearer(),
    );
    expect(resolved.statusCode, resolved.body).toBe(200);
    const body = finishBody(id);
    const first = await inject(
      'POST',
      `/api/game/sessions/${id}/finish`,
      undefined,
      body,
      bearer(),
    );
    expect(first.statusCode, first.body).toBe(200);
    const runId = (first.json() as { resultId: string }).resultId;
    const mine = completed.filter((event) => event.sessionId === id);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.runId).toBe(runId);
    expect(mine[0]?.suspicious).toBe(false);
    expect(mine[0]?.summary.loyalty).toBe(87);
    expect(mine[0]?.summary.outcome).toBe('completed');
    const run = await prisma.run.findUniqueOrThrow({ where: { sessionId: id } });
    expect(run.id).toBe(runId);
    expect(run.loyalty).toBe(87);

    const second = await inject(
      'POST',
      `/api/game/sessions/${id}/finish`,
      undefined,
      body,
      bearer(),
    );
    expect(second.statusCode).toBe(200);
    expect((second.json() as { resultId: string }).resultId).toBe(runId);
    expect(completed.filter((event) => event.sessionId === id)).toHaveLength(1);

    const changed = finishBody(id, 1);
    const conflict = await inject(
      'POST',
      `/api/game/sessions/${id}/finish`,
      undefined,
      changed,
      bearer(),
    );
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ code: 'result-conflict' });
    const still = await prisma.run.findUniqueOrThrow({ where: { id: runId } });
    expect(still.loyalty).toBe(87);
  });

  it('abort и expire закрывают смену и не пишут рейс', async () => {
    const user = await makeUser('stop');
    const opened = await open(user.id);
    const aborted = await inject(
      'POST',
      `/api/v1/game-sessions/${opened.body.sessionId}/abort`,
      user.id,
    );
    expect(aborted.statusCode).toBe(200);
    expect(aborted.json()).toEqual({ status: 'ABORTED' });
    expect(await prisma.run.findUnique({ where: { sessionId: opened.body.sessionId } })).toBeNull();
    const again = await inject(
      'POST',
      `/api/v1/game-sessions/${opened.body.sessionId}/abort`,
      user.id,
    );
    expect(again.statusCode).toBe(409);
    const audits = await prisma.auditLog.count({
      where: { target: opened.body.sessionId, action: 'session.aborted' },
    });
    expect(audits).toBe(1);

    const other = await makeUser('expire');
    const expiring = await open(other.id);
    clock.advance(2 * 60 * 60 * 1000 + 1000);
    const expired = await app.get(SessionsService).expireDue();
    expect(expired).toBeGreaterThanOrEqual(1);
    const row = await prisma.gameSession.findUniqueOrThrow({
      where: { id: expiring.body.sessionId },
    });
    expect(row.status).toBe('EXPIRED');
    expect(await prisma.run.findUnique({ where: { sessionId: row.id } })).toBeNull();
  });

  it('сид фиксирует текст и порядок, вариант не меняет очки, журнал хранит показ', async () => {
    await resetLlm('sess-llm', 'Перефраз');
    const quietA = '00000000-0000-4000-8000-0000000000b1';
    const quietB = '00000000-0000-4000-8000-0000000000b2';
    const loudA = '00000000-0000-4000-8000-0000000000c1';
    const loudB = '00000000-0000-4000-8000-0000000000c2';
    await putVariant({
      id: quietA,
      scenarioId: 'sess-llm',
      nodeId: 'pool-ask',
      persona: 'тихий',
      text: 'Тихий просит воду',
      doText: 'Налить воды',
      skipText: 'Пройти мимо',
      maxUses: 1,
    });
    await putVariant({
      id: quietB,
      scenarioId: 'sess-llm',
      nodeId: 'pool-ask',
      persona: 'тихий',
      text: 'Тихий показывает билет',
      doText: 'Проверить билет',
      skipText: 'Махнуть рукой',
      maxUses: 1,
    });
    await putVariant({
      id: loudA,
      scenarioId: 'sess-llm',
      nodeId: 'pool-ask',
      persona: 'раздражённый',
      text: 'Громкий спор у двери',
      doText: 'Снизить голос',
      skipText: 'Закрыть дверь',
      maxUses: 1,
    });
    await putVariant({
      id: loudB,
      scenarioId: 'sess-llm',
      nodeId: 'pool-ask',
      persona: 'раздражённый',
      text: 'Громкая жалоба на место',
      doText: 'Предложить другое место',
      skipText: 'Спорить в проходе',
      maxUses: 1,
    });
    const user = await makeUser('llm');
    await assignScenario(user.id, 'sess-llm');
    const opened = await open(user.id, { carClass: 'ECONOMY' });
    const row = await prisma.gameSession.findUniqueOrThrow({
      where: { id: opened.body.sessionId },
    });
    const seed = decryptSeed(row.seedEnc, config.seedEncKey);
    const persona = personaOf(createRng(seed), llmPool);
    const approved = persona === 'тихий' ? [quietA, quietB] : [loudA, loudB];
    const expectedId = pickApprovedId(createRng(seed), 'sess-llm', 'pool-ask', approved);
    if (expectedId === null) {
      throw new Error('пул пуст');
    }
    const key = textPlanKey('sess-llm', 'pool-ask');
    expect(readTextPlan(row.textPlan)?.nodes[key]).toBe(expectedId);
    const picked = await prisma.scenarioTextVariant.findUniqueOrThrow({
      where: { id: expectedId },
    });
    expect(picked.uses).toBe(1);
    expect(picked.status).toBe('RETIRED');
  });

  it('нет APPROVED — исходный текст и авторский порядок, pending не расходуется', async () => {
    await resetLlm('sess-llm', 'Перефраз');
    const pendingId = '00000000-0000-4000-8000-0000000000aa';
    await putVariant({
      id: pendingId,
      scenarioId: 'sess-llm',
      nodeId: 'pool-ask',
      persona: 'тихий',
      text: 'Это ещё не одобрено',
      doText: 'Чужое действие',
      skipText: 'Чужой пропуск',
      status: 'PENDING_REVIEW',
    });
    const seen: SessionTextRequestedPayload[] = [];
    const emitter = app.get(EventEmitter2);
    const onText = (payload: SessionTextRequestedPayload) => {
      seen.push(payload);
    };
    emitter.on(SESSION_TEXT_REQUESTED, onText);
    try {
      const user = await makeUser('fallback');
      await assignScenario(user.id, 'sess-llm');
      const opened = await open(user.id, { carClass: 'ECONOMY' });
      const row = await prisma.gameSession.findUniqueOrThrow({
        where: { id: opened.body.sessionId },
      });
      expect(readTextPlan(row.textPlan)?.nodes[textPlanKey('sess-llm', 'pool-ask')]).toBeNull();
      expect(
        seen.flatMap((event) => event.items).some((item) => item.scenarioId === 'sess-llm'),
      ).toBe(false);
      const pending = await prisma.scenarioTextVariant.findUniqueOrThrow({
        where: { id: pendingId },
      });
      expect(pending.uses).toBe(0);
    } finally {
      emitter.off(SESSION_TEXT_REQUESTED, onText);
    }
  }, 30_000);

  it('live без своего варианта не берёт чужой APPROVED и замирает на YAML', async () => {
    await resetLlm('sess-live', 'Живой перефраз');
    const user = await makeUser('live-pool');
    await assignScenario(user.id, 'sess-live');
    const opened = await open(user.id, { carClass: 'ECONOMY' });
    const row = await prisma.gameSession.findUniqueOrThrow({
      where: { id: opened.body.sessionId },
    });
    const seed = decryptSeed(row.seedEnc, config.seedEncKey);
    const persona = personaOf(createRng(seed), llmLive);
    const poolId = '00000000-0000-4000-8000-0000000000c1';
    await putVariant({
      id: poolId,
      scenarioId: 'sess-live',
      nodeId: 'live-ask',
      persona,
      text: 'Чужой текст из пула',
      doText: 'Чужое действие пула',
      skipText: 'Чужой пропуск пула',
    });
    expect(
      (await prisma.scenarioTextVariant.findUniqueOrThrow({ where: { id: poolId } })).uses,
    ).toBe(0);
    const plan = readTextPlan(
      (await prisma.gameSession.findUniqueOrThrow({ where: { id: opened.body.sessionId } }))
        .textPlan,
    );
    expect(plan?.nodes[textPlanKey('sess-live', 'live-ask')]).toBeNull();
  }, 30_000);

  it('live закрепляет вариант своей сессии и не берёт более свежий APPROVED пула', async () => {
    await resetLlm('sess-live', 'Живой перефраз');
    const seen: SessionTextRequestedPayload[] = [];
    const emitter = app.get(EventEmitter2);
    const onText = (payload: SessionTextRequestedPayload) => {
      seen.push(payload);
    };
    emitter.on(SESSION_TEXT_REQUESTED, onText);
    const user = await makeUser('live');
    await assignScenario(user.id, 'sess-live');
    const opened = await open(user.id, { carClass: 'ECONOMY' });
    const row = await prisma.gameSession.findUniqueOrThrow({
      where: { id: opened.body.sessionId },
    });
    const seed = decryptSeed(row.seedEnc, config.seedEncKey);
    const persona = personaOf(createRng(seed), llmLive);
    const key = textPlanKey('sess-live', 'live-ask');
    expect(readTextPlan(row.textPlan)?.nodes[key]).toBeNull();
    expect(seen).toContainEqual(
      expect.objectContaining({
        sessionId: opened.body.sessionId,
        items: expect.arrayContaining([
          expect.objectContaining({
            scenarioId: 'sess-live',
            version: 1,
            nodeId: 'live-ask',
            persona,
          }),
        ]),
      }),
    );
    emitter.off(SESSION_TEXT_REQUESTED, onText);
  }, 30_000);
});

async function wipe(prisma: PrismaService, ids: string[]): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  const sessions = await prisma.gameSession.findMany({
    where: { userId: { in: ids } },
    select: { id: true },
  });
  const sessionIds = sessions.map((row) => row.id);
  await prisma.pointLedger.deleteMany({ where: { userId: { in: ids } } });
  await prisma.runDecision.deleteMany({ where: { run: { userId: { in: ids } } } });
  await prisma.run.deleteMany({ where: { userId: { in: ids } } });
  if (sessionIds.length > 0) {
    await prisma.gameSession.deleteMany({ where: { id: { in: sessionIds } } });
  }
  await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
  await prisma.userAchievement.deleteMany({ where: { userId: { in: ids } } });
  await prisma.seasonScore.deleteMany({ where: { userId: { in: ids } } });
  await prisma.promotionRecommendation.deleteMany({
    where: { OR: [{ userId: { in: ids } }, { decidedById: { in: ids } }] },
  });
  await prisma.shiftAssignment.deleteMany({
    where: { OR: [{ userId: { in: ids } }, { assignedById: { in: ids } }] },
  });
  await prisma.competencyScore.deleteMany({ where: { userId: { in: ids } } });
  await prisma.auditLog.deleteMany({
    where: {
      OR: [{ actorId: { in: ids } }, { target: { in: [...ids, ...sessionIds] } }],
    },
  });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}
