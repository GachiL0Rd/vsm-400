import { createHash } from 'node:crypto';
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
import { orderChoices } from '../src/engine/text';
import { PrismaService } from '../src/prisma/prisma.service';
import { ScenariosService } from '../src/scenarios/scenarios.service';
import type { DecisionView, OpenedSession, RunReport, SessionView } from '../src/sessions/dto';
import { decryptSeed } from '../src/sessions/seed-box';
import { SessionsService } from '../src/sessions/sessions.service';
import {
  orderRng,
  personaOf,
  pickApprovedId,
  readTextPlan,
  textPlanKey,
} from '../src/sessions/text-plan';
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

function reportBody(): RunReport {
  return {
    contractVersion: 1,
    protocolVersion: 1,
    scenarioId: 'pressure',
    simulationSeconds: 40,
    outcome: 'completed',
    outcomeNote: 'Доложено',
    safety: 89,
    loyalty: 87,
    facts: { prevented: 1, incidents: 0, complaints: 0, interventions: 0 },
    decisions: [
      {
        id: 'report-panel',
        time: '00:20',
        stage: 'ride',
        verdict: 'correct',
        safety: 0,
        loyalty: 0,
        reactionSec: 12,
        lucky: false,
      },
      {
        id: 'late-call',
        time: '00:40',
        stage: 'boarding',
        verdict: 'late',
        safety: -2,
        loyalty: 1,
        reactionSec: 0.2,
      },
      {
        id: 'wrong',
        time: '00:50',
        stage: 'enroute',
        verdict: 'incorrect',
        safety: -5,
        loyalty: -1,
      },
      {
        id: 'skip',
        time: '01:00',
        stage: 'stop',
        verdict: 'missed',
        safety: -3,
        loyalty: -2,
      },
    ],
    checks: [
      {
        id: 'pressure-panel',
        detected: true,
        reportRequired: true,
        reported: true,
        actionCorrect: true,
        consequenceRolled: false,
      },
    ],
  };
}

describe('игровые сессии', () => {
  const clock = new ManualClock();
  const userIds: string[] = [];
  const completed: RunCompletedPayload[] = [];
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let config: AppConfig;
  let redisUrl = '';
  const serviceToken = process.env.GAME_SERVER_TOKEN ?? '';

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
    body: { transport: 'REST' | 'WS'; carClass?: 'ECONOMY' } = { transport: 'REST' },
  ): Promise<{ response: LightMyRequestResponse; body: OpenedSession }> {
    const response = await inject('POST', '/api/v1/game-sessions', userId, body);
    expect(response.statusCode).toBe(200);
    return { response, body: response.json() as OpenedSession };
  }

  function listen(channel: string): Promise<{
    next: () => Promise<string>;
    close: () => Promise<void>;
  }> {
    const sub = new Redis(redisUrl);
    const queue: string[] = [];
    let pending: ((value: string) => void) | null = null;
    sub.on('message', (_name, message) => {
      if (pending) {
        const resolve = pending;
        pending = null;
        resolve(message);
        return;
      }
      queue.push(message);
    });
    return sub.subscribe(channel).then(() => ({
      next: () => {
        const ready = queue.shift();
        if (ready !== undefined) {
          return Promise.resolve(ready);
        }
        return new Promise((resolve) => {
          pending = resolve;
        });
      },
      close: async () => {
        await sub.unsubscribe(channel);
        await sub.quit();
      },
    }));
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
    const first = await open(user.id, { transport: 'REST', carClass: 'ECONOMY' });
    expect(first.body.wsUrl).toBe(config.publicGameWsUrl);
    expect(first.body.plan.segments).toBeGreaterThan(0);
    expect(first.body.plan.titles.length).toBe(first.body.plan.segments);
    expect(first.body.plan.carClass).toBe('ECONOMY');
    const cookie = String(first.response.headers['set-cookie']);
    expect(cookie).toContain('vsm_game=');
    expect(cookie.toLowerCase()).toContain('httponly');
    expect(cookie.toLowerCase()).toContain('path=/game-ws');
    expect(cookie.toLowerCase()).toContain('samesite=strict');

    const row = await prisma.gameSession.findUniqueOrThrow({ where: { id: first.body.sessionId } });
    expect(row.status).toBe('ACTIVE');
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

    const anon = await inject('POST', '/api/v1/game-sessions', undefined, { transport: 'REST' });
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
    const reported = await inject(
      'POST',
      `/api/internal/v1/game-sessions/${opened.body.sessionId}/report`,
      undefined,
      reportBody(),
      { 'x-service-token': serviceToken },
    );
    expect(reported.statusCode).toBe(200);
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
      'GET',
      `/api/v1/game-sessions/${opened.body.sessionId}`,
      other.id,
    );
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('повтор seq отдаёт тот же ответ, другой choiceId — 409', async () => {
    const user = await makeUser('seq');
    const opened = await open(user.id);
    const view = await inject('GET', `/api/v1/game-sessions/${opened.body.sessionId}`, user.id);
    expect(view.statusCode).toBe(200);
    const current = view.json() as SessionView;
    const choice = current.view.choices[0];
    expect(choice).toBeTruthy();
    clock.advance(1000);
    const payload = { seq: current.seq, choiceId: choice?.id, clientTs: clock.current.getTime() };
    const first = await inject(
      'POST',
      `/api/v1/game-sessions/${opened.body.sessionId}/decisions`,
      user.id,
      payload,
    );
    expect(first.statusCode).toBe(200);
    const second = await inject(
      'POST',
      `/api/v1/game-sessions/${opened.body.sessionId}/decisions`,
      user.id,
      payload,
    );
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual(first.json());
    const mismatch = await inject(
      'POST',
      `/api/v1/game-sessions/${opened.body.sessionId}/decisions`,
      user.id,
      { seq: current.seq, choiceId: 'other-choice' },
    );
    expect(mismatch.statusCode).toBe(409);
    expect(mismatch.json()).toMatchObject({ code: 'SEQ_MISMATCH' });
    const events = await prisma.gameEvent.count({
      where: { sessionId: opened.body.sessionId, type: 'decision' },
    });
    expect(events).toBe(1);
  });

  it('телеметрия seq=1 не блокирует ход seq=1', async () => {
    const user = await makeUser('telemetry');
    const opened = await open(user.id);
    const id = opened.body.sessionId;
    const headers = { 'x-service-token': serviceToken };
    const current = (
      await inject('GET', `/api/v1/game-sessions/${id}`, user.id)
    ).json() as SessionView;
    const posted = await inject(
      'POST',
      `/api/internal/v1/game-sessions/${id}/events`,
      undefined,
      { events: [{ seq: 1, type: 'focus', payload: { zone: 'door' } }] },
      headers,
    );
    expect(posted.statusCode).toBe(200);
    expect(posted.json()).toEqual({ accepted: 1, duplicates: 0 });

    let seq = current.seq;
    let choices = current.view.choices;
    let guard = 0;
    while (seq < 1 && guard < 8) {
      const choice = choices[0];
      expect(choice).toBeTruthy();
      clock.advance(1000);
      const response = await inject('POST', `/api/v1/game-sessions/${id}/decisions`, user.id, {
        seq,
        choiceId: choice?.id,
      });
      expect(response.statusCode, response.body).toBe(200);
      const body = response.json() as DecisionView;
      seq = body.seq;
      choices = body.view.choices;
      guard += 1;
      if (body.finished) {
        break;
      }
    }
    expect(seq).toBe(1);
    const choice = choices[0];
    expect(choice).toBeTruthy();
    clock.advance(1000);
    const move = await inject('POST', `/api/v1/game-sessions/${id}/decisions`, user.id, {
      seq: 1,
      choiceId: choice?.id,
    });
    expect(move.statusCode, move.body).toBe(200);
    const decision = await prisma.gameEvent.findUnique({
      where: { sessionId_seq: { sessionId: id, seq: 1 } },
    });
    expect(decision?.type).toBe('decision');
    const telemetry = await prisma.gameTelemetry.findUnique({
      where: { sessionId_seq: { sessionId: id, seq: 1 } },
    });
    expect(telemetry?.type).toBe('focus');
  });

  it('ход после дедлайна становится timeout', async () => {
    const user = await makeUser('late');
    const opened = await open(user.id);
    const view = (
      await inject('GET', `/api/v1/game-sessions/${opened.body.sessionId}`, user.id)
    ).json() as SessionView;
    expect(view.view.timerSec).toBeGreaterThan(0);
    expect(view.deadlineAt).toBeTruthy();
    const deadline = new Date(view.deadlineAt ?? 0);
    clock.current = new Date(deadline.getTime() + 600);
    const response = await inject(
      'POST',
      `/api/v1/game-sessions/${opened.body.sessionId}/decisions`,
      user.id,
      { seq: view.seq, choiceId: view.view.choices[0]?.id },
    );
    expect(response.statusCode).toBe(200);
    const body = response.json() as DecisionView;
    expect(body.applied).toBe('timeout');
    const row = await prisma.gameSession.findUniqueOrThrow({
      where: { id: opened.body.sessionId },
    });
    const state = row.state as { journal: { choiceId: string }[] };
    expect(state.journal.at(-1)?.choiceId).toBe('timeout');
    expect(row.flags).toContain('decision-after-deadline');
    const reported = await inject(
      'POST',
      `/api/internal/v1/game-sessions/${opened.body.sessionId}/report`,
      undefined,
      reportBody(),
      { 'x-service-token': serviceToken },
    );
    expect(reported.statusCode).toBe(200);
    const mine = completed.filter((event) => event.sessionId === opened.body.sessionId);
    expect(mine[0]?.suspicious).toBe(false);
    const run = await prisma.run.findUniqueOrThrow({
      where: { sessionId: opened.body.sessionId },
    });
    expect(run.suspicious).toBe(false);
  });

  it('GET сам применяет timeout, когда дедлайн прошёл', async () => {
    const user = await makeUser('lazy');
    const opened = await open(user.id);
    const before = (
      await inject('GET', `/api/v1/game-sessions/${opened.body.sessionId}`, user.id)
    ).json() as SessionView;
    clock.current = new Date(new Date(before.deadlineAt ?? 0).getTime() + 600);
    const after = (
      await inject('GET', `/api/v1/game-sessions/${opened.body.sessionId}`, user.id)
    ).json() as SessionView;
    expect(after.seq).toBeGreaterThan(before.seq);
    const row = await prisma.gameSession.findUniqueOrThrow({
      where: { id: opened.body.sessionId },
    });
    const state = row.state as { journal: { choiceId: string }[] };
    expect(state.journal.at(-1)?.choiceId).toBe('timeout');
    expect(row.flags).not.toContain('decision-after-deadline');
  });

  it('clientTs на минуту раньше не ставит флаг', async () => {
    const user = await makeUser('skew');
    const opened = await open(user.id);
    const id = opened.body.sessionId;
    const view = (
      await inject('GET', `/api/v1/game-sessions/${id}`, user.id)
    ).json() as SessionView;
    const choice = view.view.choices[0];
    expect(choice).toBeTruthy();
    clock.advance(1000);
    const clientTs = clock.current.getTime() - 60_000;
    const response = await inject('POST', `/api/v1/game-sessions/${id}/decisions`, user.id, {
      seq: view.seq,
      choiceId: choice?.id,
      clientTs,
    });
    expect(response.statusCode, response.body).toBe(200);
    const row = await prisma.gameSession.findUniqueOrThrow({ where: { id } });
    expect(row.flags).not.toContain('decision-before-show');
    const event = await prisma.gameEvent.findFirst({
      where: { sessionId: id, type: 'decision' },
    });
    expect(event?.clientAt?.getTime()).toBe(clientTs);
  });

  it('clientTs за пределом Date — 422', async () => {
    const user = await makeUser('clock');
    const opened = await open(user.id);
    const id = opened.body.sessionId;
    const view = (
      await inject('GET', `/api/v1/game-sessions/${id}`, user.id)
    ).json() as SessionView;
    const response = await inject('POST', `/api/v1/game-sessions/${id}/decisions`, user.id, {
      seq: view.seq,
      choiceId: view.view.choices[0]?.id,
      clientTs: 9e15,
    });
    expect(response.statusCode).toBe(422);
    expect(await prisma.gameEvent.count({ where: { sessionId: id } })).toBe(0);
  });

  it('ход REST и WS не подменяют канал друг друга', async () => {
    const user = await makeUser('channel');
    const ws = await open(user.id, { transport: 'WS' });
    const wsId = ws.body.sessionId;
    const screen = (
      await inject('GET', `/api/v1/game-sessions/${wsId}`, user.id)
    ).json() as SessionView;
    const choice = screen.view.choices[0];
    expect(choice).toBeTruthy();
    const restMove = await inject('POST', `/api/v1/game-sessions/${wsId}/decisions`, user.id, {
      seq: screen.seq,
      choiceId: choice?.id,
    });
    expect(restMove.statusCode).toBe(409);
    expect(restMove.json()).toMatchObject({ code: 'WRONG_TRANSPORT' });
    clock.current = new Date(new Date(screen.deadlineAt ?? 0).getTime() + 600);
    const later = (
      await inject('GET', `/api/v1/game-sessions/${wsId}`, user.id)
    ).json() as SessionView;
    expect(later.seq).toBe(screen.seq);
    const headers = { 'x-service-token': serviceToken };
    const internal = await inject(
      'POST',
      `/api/internal/v1/game-sessions/${wsId}/decisions`,
      undefined,
      { seq: screen.seq, choiceId: choice?.id },
      headers,
    );
    expect(internal.statusCode, internal.body).toBe(200);

    const other = await makeUser('channel-rest');
    const rest = await open(other.id);
    const restView = (
      await inject('GET', `/api/v1/game-sessions/${rest.body.sessionId}`, other.id)
    ).json() as SessionView;
    const wrong = await inject(
      'POST',
      `/api/internal/v1/game-sessions/${rest.body.sessionId}/decisions`,
      undefined,
      { seq: restView.seq, choiceId: restView.view.choices[0]?.id },
      headers,
    );
    expect(wrong.statusCode).toBe(409);
    expect(wrong.json()).toMatchObject({ code: 'WRONG_TRANSPORT' });
    clock.advance(1000);
    const ok = await inject(
      'POST',
      `/api/v1/game-sessions/${rest.body.sessionId}/decisions`,
      other.id,
      { seq: restView.seq, choiceId: restView.view.choices[0]?.id },
    );
    expect(ok.statusCode, ok.body).toBe(200);
  });

  it('REST-прогон доходит до финала и раскрывает seed', async () => {
    const user = await makeUser('play');
    const opened = await open(user.id);
    const id = opened.body.sessionId;
    for (let step = 0; step < 48; step += 1) {
      const current = (
        await inject('GET', `/api/v1/game-sessions/${id}`, user.id)
      ).json() as SessionView;
      if (current.status === 'COMPLETED' || current.view.finished) {
        break;
      }
      const choice = current.view.choices[0];
      expect(choice).toBeTruthy();
      clock.advance(1000);
      const decided = await inject('POST', `/api/v1/game-sessions/${id}/decisions`, user.id, {
        seq: current.seq,
        choiceId: choice?.id,
        clientTs: clock.current.getTime(),
      });
      expect(decided.statusCode).toBe(200);
      const body = decided.json() as DecisionView;
      if (body.finished || body.status === 'COMPLETED') {
        break;
      }
      if (step === 47) {
        throw new Error('финал не достигнут');
      }
    }
    const mine = completed.filter((event) => event.sessionId === id);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.userId).toBe(user.id);
    expect(mine[0]?.summary.outcome).toEqual(expect.any(String));
    expect(mine[0]?.suspicious).toBe(false);
    const run = await prisma.run.findUnique({ where: { sessionId: id } });
    expect(run?.id).toBe(mine[0]?.runId);
    const stored = await prisma.gameSession.findUniqueOrThrow({ where: { id } });
    const result = stored.result as {
      runId: string;
      suspicious: boolean;
      summary: { outcome: string };
    };
    expect(result).toMatchObject({ runId: mine[0]?.runId, suspicious: false });
    expect(result.summary.outcome).toEqual(expect.any(String));
    const completedAudit = await prisma.auditLog.findFirst({
      where: { action: 'session.completed', target: id },
    });
    expect(completedAudit?.meta).toEqual({ runId: result.runId, suspicious: false });
    const last = await prisma.gameEvent.findFirst({
      where: { sessionId: id, type: 'decision' },
      orderBy: { seq: 'desc' },
    });
    const replayPayload = last?.payload as { choiceId?: string } | null;
    expect(typeof replayPayload?.choiceId).toBe('string');
    await prisma.auditLog.deleteMany({ where: { action: 'session.completed', target: id } });
    const replay = await inject('POST', `/api/v1/game-sessions/${id}/decisions`, user.id, {
      seq: last?.seq,
      choiceId: replayPayload?.choiceId,
    });
    expect(replay.statusCode, replay.body).toBe(200);
    expect(completed.filter((event) => event.sessionId === id)).toHaveLength(1);

    const reveal = await inject('GET', `/api/v1/game-sessions/${id}/reveal`, user.id);
    expect(reveal.statusCode).toBe(200);
    const revealed = reveal.json() as { seed: string; commit: string };
    const seed = Buffer.from(revealed.seed, 'hex');
    expect(createHash('sha256').update(seed).digest('hex')).toBe(revealed.commit);
    expect(revealed.commit).toBe(opened.body.seedCommit);
  }, 30_000);

  it('билет одноразовый и переводит PENDING в ACTIVE', async () => {
    const user = await makeUser('ticket');
    const opened = await open(user.id, { transport: 'WS' });
    const pending = await prisma.gameSession.findUniqueOrThrow({
      where: { id: opened.body.sessionId },
    });
    expect(pending.status).toBe('PENDING');
    const denied = await inject('POST', '/api/internal/v1/tickets/verify', undefined, {
      ticket: opened.body.ticket,
    });
    expect(denied.statusCode).toBe(401);

    const verified = await inject(
      'POST',
      '/api/internal/v1/tickets/verify',
      undefined,
      { ticket: opened.body.ticket },
      {
        'x-service-token': serviceToken,
      },
    );
    expect(verified.statusCode).toBe(200);
    expect(verified.json()).toMatchObject({
      userId: user.id,
      callsign: user.callsign,
      sessionId: opened.body.sessionId,
      status: 'ACTIVE',
    });
    const plan = (verified.json() as { plan: { scenarios: unknown[] } }).plan;
    expect(plan.scenarios.length).toBeGreaterThan(0);
    const redis = new Redis(redisUrl);
    expect(await redis.get(`vsm:ticket:${ticketPayload(opened.body.ticket).jti}`)).toBe('1');
    await redis.quit();

    const reused = await inject(
      'POST',
      '/api/internal/v1/tickets/verify',
      undefined,
      { ticket: opened.body.ticket },
      { 'x-service-token': serviceToken },
    );
    expect(reused.statusCode).toBe(409);
    expect(reused.json()).toMatchObject({ code: 'TICKET_REUSED' });
    const flagged = await prisma.gameSession.findUniqueOrThrow({
      where: { id: opened.body.sessionId },
    });
    expect(flagged.flags).toContain('ticket-reused');

    const garbage = await inject(
      'POST',
      '/api/internal/v1/tickets/verify',
      undefined,
      { ticket: 'not-a-jwt' },
      { 'x-service-token': serviceToken },
    );
    expect(garbage.statusCode).toBe(401);
    expect(garbage.json()).toMatchObject({ code: 'INVALID_TICKET' });
  });

  it('отчёт мапится в рейс и повтор отдаёт тот же runId', async () => {
    const user = await makeUser('report');
    const opened = await open(user.id);
    const id = opened.body.sessionId;
    const headers = { 'x-service-token': serviceToken };
    const first = await inject(
      'POST',
      `/api/internal/v1/game-sessions/${id}/report`,
      undefined,
      reportBody(),
      headers,
    );
    expect(first.statusCode).toBe(200);
    const runId = (first.json() as { runId: string }).runId;
    const mine = completed.filter((event) => event.sessionId === id);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.runId).toBe(runId);
    expect(mine[0]?.suspicious).toBe(false);
    expect(mine[0]?.summary.decisions.map((decision) => decision.verdict)).toEqual([
      'best',
      'ok',
      'worse',
      'missed',
    ]);
    expect(mine[0]?.summary.decisions.map((decision) => decision.stage)).toEqual([
      'enroute',
      'boarding',
      'enroute',
      'stop',
    ]);
    expect(mine[0]?.summary.decisions[0]?.reactionMs).toBe(12_000);
    expect(mine[0]?.summary.decisions[1]?.reactionMs).toBe(200);
    expect(mine[0]?.summary.timeouts).toBe(1);
    expect(mine[0]?.summary.facts.prevented).toBe(1);
    const run = await prisma.run.findUniqueOrThrow({ where: { sessionId: id } });
    expect(run.id).toBe(runId);

    const changed = reportBody();
    changed.loyalty = 1;
    const second = await inject(
      'POST',
      `/api/internal/v1/game-sessions/${id}/report`,
      undefined,
      changed,
      headers,
    );
    expect(second.statusCode).toBe(200);
    expect((second.json() as { runId: string }).runId).toBe(runId);
    expect(completed.filter((event) => event.sessionId === id)).toHaveLength(1);
    const still = await prisma.run.findUniqueOrThrow({ where: { id: runId } });
    expect(still.loyalty).toBe(87);
    const stored = await prisma.gameSession.findUniqueOrThrow({ where: { id } });
    const result = stored.result as {
      runId: string;
      suspicious: boolean;
      summary: { loyalty: number };
    };
    expect(result).toMatchObject({ runId, suspicious: false });
    expect(result.summary.loyalty).toBe(87);
    const completedAudit = await prisma.auditLog.findFirst({
      where: { action: 'session.completed', target: id },
    });
    expect(completedAudit?.meta).toEqual({ runId, suspicious: false });
    await prisma.auditLog.deleteMany({ where: { action: 'session.completed', target: id } });
    const third = await inject(
      'POST',
      `/api/internal/v1/game-sessions/${id}/report`,
      undefined,
      reportBody(),
      headers,
    );
    expect(third.statusCode).toBe(200);
    expect((third.json() as { runId: string }).runId).toBe(runId);
    expect(completed.filter((event) => event.sessionId === id)).toHaveLength(1);

    const batch = {
      events: [
        {
          seq: 50,
          type: 'ping',
          payload: { ok: true },
          clientAt: '2020-01-01T00:00:00.000Z',
        },
      ],
    };
    const accepted = await inject(
      'POST',
      `/api/internal/v1/game-sessions/${id}/events`,
      undefined,
      batch,
      headers,
    );
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toEqual({ accepted: 1, duplicates: 0 });
    const duplicate = await inject(
      'POST',
      `/api/internal/v1/game-sessions/${id}/events`,
      undefined,
      batch,
      headers,
    );
    expect(duplicate.json()).toEqual({ accepted: 0, duplicates: 1 });
  });

  it('abort и expire публикуют redis и не пишут рейс', async () => {
    const user = await makeUser('stop');
    const opened = await open(user.id);
    const channel = `vsm:game:${opened.body.sessionId}`;
    const ear = await listen(channel);
    const aborted = await inject(
      'POST',
      `/api/v1/game-sessions/${opened.body.sessionId}/abort`,
      user.id,
    );
    expect(aborted.statusCode).toBe(200);
    expect(aborted.json()).toEqual({ status: 'ABORTED' });
    const abortMessage = JSON.parse(await ear.next()) as { type: string };
    expect(abortMessage.type).toBe('abort');
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
    await ear.close();

    const other = await makeUser('expire');
    const expiring = await open(other.id);
    const expireEar = await listen(`vsm:game:${expiring.body.sessionId}`);
    clock.advance(2 * 60 * 60 * 1000 + 1000);
    const expired = await app.get(SessionsService).expireDue();
    expect(expired).toBeGreaterThanOrEqual(1);
    const row = await prisma.gameSession.findUniqueOrThrow({
      where: { id: expiring.body.sessionId },
    });
    expect(row.status).toBe('EXPIRED');
    expect(await prisma.run.findUnique({ where: { sessionId: row.id } })).toBeNull();
    const expireMessage = JSON.parse(await expireEar.next()) as { type: string; sessionId: string };
    expect(expireMessage).toMatchObject({ type: 'expire', sessionId: row.id });
    await expireEar.close();
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
    const opened = await open(user.id, { transport: 'REST', carClass: 'ECONOMY' });
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
    const payload = picked.payload as { text: string; choices: { id: string; text: string }[] };
    const first = await inject('GET', `/api/v1/game-sessions/${opened.body.sessionId}`, user.id);
    expect(first.statusCode, first.body).toBe(200);
    const screen = first.json() as SessionView;
    expect(screen.view.nodeId).toBe('pool-ask');
    expect(screen.view.text).toBe(payload.text);
    expect(screen.scales).toMatchObject({ loyalty: 60, safety: 60 });
    const listed = ['do', 'skip'].map((id) => {
      const choice = payload.choices.find((item) => item.id === id);
      if (!choice) {
        throw new Error('в варианте нет выбора');
      }
      return choice;
    });
    const expectedOrder = orderChoices(
      listed,
      orderRng(createRng(seed), 'sess-llm', 'pool-ask', screen.view.seq),
    );
    expect(screen.view.choices).toEqual(expectedOrder);
    const again = await inject('GET', `/api/v1/game-sessions/${opened.body.sessionId}`, user.id);
    expect((again.json() as SessionView).view.choices).toEqual(screen.view.choices);
    expect((again.json() as SessionView).view.text).toBe(screen.view.text);

    clock.advance(1000);
    const doText = screen.view.choices.find((choice) => choice.id === 'do')?.text;
    const decided = await inject(
      'POST',
      `/api/v1/game-sessions/${opened.body.sessionId}/decisions`,
      user.id,
      { seq: screen.seq, choiceId: 'do', clientTs: clock.current.getTime() },
    );
    expect(decided.statusCode, decided.body).toBe(200);
    const stepBody = decided.json() as DecisionView;
    expect(stepBody.scales).toMatchObject({ loyalty: 65, safety: 65 });
    expect(stepBody.view.nodeId).not.toBe('pool-ask');
    expect(stepBody.finished).toBe(false);

    let finished = false;
    let seq = stepBody.seq;
    let choices = stepBody.view.choices;
    let guard = 0;
    while (!finished && guard < 8) {
      const choice = choices[0];
      if (!choice) {
        break;
      }
      clock.advance(1000);
      const response = await inject(
        'POST',
        `/api/v1/game-sessions/${opened.body.sessionId}/decisions`,
        user.id,
        { seq, choiceId: choice.id, clientTs: clock.current.getTime() },
      );
      expect(response.statusCode, response.body).toBe(200);
      const body = response.json() as DecisionView;
      finished = body.finished;
      seq = body.seq;
      choices = body.view.choices;
      guard += 1;
    }
    expect(finished).toBe(true);
    const run = await prisma.run.findUnique({ where: { sessionId: opened.body.sessionId } });
    if (!run) {
      throw new Error('рейс не записан');
    }
    const detail = await inject('GET', `/api/v1/me/runs/${run.id}`, user.id);
    expect(detail.statusCode, detail.body).toBe(200);
    const shown = (
      detail.json() as {
        decisions: {
          situation: string;
          action: string;
          loyalty: number;
          safety: number;
          verdict: string;
        }[];
      }
    ).decisions.find((decision) => decision.situation === payload.text);
    expect(shown).toMatchObject({
      action: doText,
      loyalty: 5,
      safety: 5,
      verdict: 'best',
    });
  }, 30_000);

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
      const opened = await open(user.id, { transport: 'REST', carClass: 'ECONOMY' });
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
      const view = await inject('GET', `/api/v1/game-sessions/${opened.body.sessionId}`, user.id);
      expect(view.statusCode, view.body).toBe(200);
      const screen = view.json() as SessionView;
      expect(screen.view.nodeId).toBe('pool-ask');
      expect(screen.view.text).toBe('Исходная ситуация');
      expect(screen.view.choices.map((choice) => choice.id)).toEqual(['do', 'skip']);
      expect(screen.view.choices.map((choice) => choice.text)).toEqual([
        'Сделать по регламенту',
        'Пропустить',
      ]);
    } finally {
      emitter.off(SESSION_TEXT_REQUESTED, onText);
    }
  }, 30_000);

  it('live без своего варианта не берёт чужой APPROVED и замирает на YAML', async () => {
    await resetLlm('sess-live', 'Живой перефраз');
    const user = await makeUser('live-pool');
    await assignScenario(user.id, 'sess-live');
    const opened = await open(user.id, { transport: 'REST', carClass: 'ECONOMY' });
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
    const view = await inject('GET', `/api/v1/game-sessions/${opened.body.sessionId}`, user.id);
    expect(view.statusCode, view.body).toBe(200);
    expect((view.json() as SessionView).view.text).toBe('Исходная ситуация');
    expect(
      (await prisma.scenarioTextVariant.findUniqueOrThrow({ where: { id: poolId } })).uses,
    ).toBe(0);
    const plan = readTextPlan(
      (await prisma.gameSession.findUniqueOrThrow({ where: { id: opened.body.sessionId } }))
        .textPlan,
    );
    expect(plan?.nodes[textPlanKey('sess-live', 'live-ask')]).toBeNull();
    expect(plan?.shown).toContain(textPlanKey('sess-live', 'live-ask'));
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
    const opened = await open(user.id, { transport: 'REST', carClass: 'ECONOMY' });
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
    const own = '00000000-0000-4000-8000-0000000000d2';
    const poolNewer = '00000000-0000-4000-8000-0000000000d3';
    const after = '00000000-0000-4000-8000-0000000000d4';
    await putVariant({
      id: own,
      scenarioId: 'sess-live',
      nodeId: 'live-ask',
      persona,
      text: 'Текст этой сессии',
      doText: 'Действие этой сессии',
      skipText: 'Пропуск этой сессии',
      sessionId: opened.body.sessionId,
      createdAt: new Date('2020-01-02T00:00:00.000Z'),
    });
    await putVariant({
      id: poolNewer,
      scenarioId: 'sess-live',
      nodeId: 'live-ask',
      persona,
      text: 'Более свежий текст пула',
      doText: 'Свежее чужое действие',
      skipText: 'Свежий чужой пропуск',
      createdAt: new Date('2020-01-05T00:00:00.000Z'),
    });
    const first = await inject('GET', `/api/v1/game-sessions/${opened.body.sessionId}`, user.id);
    expect(first.statusCode, first.body).toBe(200);
    const screen = first.json() as SessionView;
    expect(screen.view.text).toBe('Текст этой сессии');
    const listed = [
      { id: 'do', text: 'Действие этой сессии' },
      { id: 'skip', text: 'Пропуск этой сессии' },
    ];
    expect(screen.view.choices).toEqual(
      orderChoices(listed, orderRng(createRng(seed), 'sess-live', 'live-ask', screen.view.seq)),
    );
    const pinned = await prisma.gameSession.findUniqueOrThrow({
      where: { id: opened.body.sessionId },
    });
    const plan = readTextPlan(pinned.textPlan);
    expect(plan?.nodes[key]).toBe(own);
    expect(plan?.shown).toContain(key);
    expect((await prisma.scenarioTextVariant.findUniqueOrThrow({ where: { id: own } })).uses).toBe(
      1,
    );
    expect(
      (await prisma.scenarioTextVariant.findUniqueOrThrow({ where: { id: poolNewer } })).uses,
    ).toBe(0);

    await putVariant({
      id: after,
      scenarioId: 'sess-live',
      nodeId: 'live-ask',
      persona,
      text: 'Текст после показа',
      doText: 'Позднее действие',
      skipText: 'Поздний пропуск',
      sessionId: opened.body.sessionId,
      createdAt: new Date('2020-01-06T00:00:00.000Z'),
    });
    const second = await inject('GET', `/api/v1/game-sessions/${opened.body.sessionId}`, user.id);
    expect((second.json() as SessionView).view.text).toBe('Текст этой сессии');
    expect((second.json() as SessionView).view.choices).toEqual(screen.view.choices);
    expect(
      (await prisma.scenarioTextVariant.findUniqueOrThrow({ where: { id: after } })).uses,
    ).toBe(0);
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
    await prisma.gameTelemetry.deleteMany({ where: { sessionId: { in: sessionIds } } });
    await prisma.gameEvent.deleteMany({ where: { sessionId: { in: sessionIds } } });
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
