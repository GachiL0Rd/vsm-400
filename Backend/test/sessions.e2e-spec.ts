import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { LightMyRequestResponse } from 'fastify';
import Redis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { AccessGuard } from '../src/auth/access.guard';
import type { RunCompletedPayload } from '../src/common/events';
import { RUN_COMPLETED } from '../src/common/events';
import { APP_CONFIG, type AppConfig, loadConfig } from '../src/config/env';
import { configureApp } from '../src/configure-app';
import { commitOf } from '../src/engine/rng';
import type { ScenarioGraph } from '../src/engine/schema';
import { PrismaService } from '../src/prisma/prisma.service';
import { ScenariosService } from '../src/scenarios/scenarios.service';
import { Clock } from '../src/sessions/clock';
import type { DecisionView, OpenedSession, RunReport, SessionView } from '../src/sessions/dto';
import { decryptSeed } from '../src/sessions/seed-box';
import { SessionsService } from '../src/sessions/sessions.service';
import { randomCallsign } from '../src/users/callsign';
import { HeaderAccessGuard } from './header-access.guard';

function envLine(name: string): string {
  const text = readFileSync('.env', 'utf8');
  for (const line of text.split('\n')) {
    if (line.startsWith(`${name}=`)) {
      return line.slice(name.length + 1).trim();
    }
  }
  throw new Error(`В Backend/.env нет ${name}`);
}

/** Соседние e2e отрезают суффикс /vsm. Наша база всегда vsm_sessions. */
function sessionsDatabaseUrl(): string {
  const url = new URL(envLine('DATABASE_URL'));
  url.pathname = '/vsm_sessions';
  return url.toString();
}

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

const fixtureGraphs = [
  linear('sess-accept', 'Приёмка', 'acceptance', 20),
  linear('sess-ride', 'Перегон', 'enroute', 15),
  linear('sess-hand', 'Сдача', 'handover', 12),
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
    redisUrl = envLine('REDIS_URL');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG)
      .useValue(
        loadConfig({
          ...process.env,
          DATABASE_URL: sessionsDatabaseUrl(),
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
    expect(flagged.flags).toContain('multi-session');
    const audits = await prisma.auditLog.count({
      where: { target: row.id, action: 'anticheat.multi-session' },
    });
    expect(audits).toBe(1);
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
