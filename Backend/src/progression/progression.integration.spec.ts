import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { ZodValidationPipe } from 'nestjs-zod';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { testDatabaseUrl, testRedisUrl } from '../../test/databases';
import { AchievementsModule } from '../achievements/achievements.module';
import { AchievementsService } from '../achievements/achievements.service';
import type { AuthUser } from '../auth/auth-user';
import { lifetimeLevelPoints } from '../cabinet/points';
import { ClockModule } from '../common/clock';
import { RUN_RECORDED, type RunCompletedPayload } from '../common/events';
import { ProblemFilter } from '../common/problem.filter';
import { ConfigModule } from '../config/config.module';
import { APP_CONFIG, loadConfig } from '../config/env';
import { configureApp } from '../configure-app';
import type { JournalEntry, RunSummary } from '../engine/types';
import { Competency, Role } from '../generated/prisma/client';
import { appliedRunKey, companyBoardKey } from '../leaderboard/keys';
import { LeaderboardModule } from '../leaderboard/leaderboard.module';
import { NotificationListener } from '../notifications/notification.listener';
import { PrismaService } from '../prisma/prisma.service';
import { RedisModule } from '../redis/redis.module';
import { RedisService } from '../redis/redis.service';
import { PromotionsService } from './promotions.service';
import { RunRecorder } from './run-recorder';

@Module({
  imports: [
    ConfigModule,
    EventEmitterModule.forRoot(),
    ClockModule,
    RedisModule,
    AchievementsModule,
    LeaderboardModule,
  ],
  providers: [
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_FILTER, useClass: ProblemFilter },
  ],
})
class ProgressionTestModule {}

function testConfig() {
  return loadConfig({
    ...process.env,
    DATABASE_URL: testDatabaseUrl('progression'),
    REDIS_URL: testRedisUrl('progression'),
  });
}

function moscowNoon(dayOffset: number): Date {
  const formatted = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const [year, month, day] = formatted.split('-').map(Number);
  return new Date(Date.UTC(year ?? 2026, (month ?? 1) - 1, (day ?? 1) + dayOffset, 9, 0, 0));
}

let callsignSeq = 0;

function callsign(): string {
  callsignSeq += 1;
  return `A${callsignSeq.toString(16).padStart(3, '0').slice(-3)}`.toUpperCase();
}

function decision(
  partial: Partial<JournalEntry> & Pick<JournalEntry, 'scenarioId' | 'verdict' | 'stage'>,
): JournalEntry {
  return {
    idx: 0,
    gameTime: '09:00',
    nodeId: 'n1',
    choiceId: 'look',
    situation: 'Проверка',
    action: 'Осмотрел',
    loyaltyDelta: 0,
    safetyDelta: 0,
    reactionMs: null,
    timerSec: null,
    consequence: null,
    lucky: false,
    better: null,
    basis: null,
    deviation: false,
    ...partial,
  };
}

function summary(partial: Partial<RunSummary> = {}): RunSummary {
  return {
    outcome: 'completed',
    loyalty: 80,
    safety: 60,
    politeness: 70,
    timeouts: 0,
    reactionAvgMs: 0,
    competencyDelta: {},
    decisions: [],
    facts: { prevented: 0, incidents: 0, complaints: 0, interventions: 0 },
    ...partial,
  };
}

type Bag = { users: string[]; brigades: string[]; depots: string[]; scenarios: string[] };

describe('прогрессия в базе', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let recorder: RunRecorder;
  let achievements: AchievementsService;
  let promotions: PromotionsService;
  const bag: Bag = { users: [], brigades: [], depots: [], scenarios: [] };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ProgressionTestModule] })
      .overrideProvider(APP_CONFIG)
      .useValue(testConfig())
      // Слушатель ленты без promisify дописывает строку уже после хода. В этом наборе он не нужен.
      .overrideProvider(NotificationListener)
      .useValue({})
      .compile();
    app = moduleRef.createNestApplication(new FastifyAdapter({ bodyLimit: 1_048_576 }), {
      logger: false,
    });
    await configureApp(app);
    app
      .getHttpAdapter()
      .getInstance()
      .addHook('onRequest', (request, _reply, done) => {
        const raw = request.headers['x-test-user'];
        if (typeof raw === 'string') {
          (request as { user?: AuthUser }).user = JSON.parse(raw) as AuthUser;
        }
        done();
      });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    prisma = app.get(PrismaService);
    recorder = app.get(RunRecorder);
    achievements = app.get(AchievementsService);
    promotions = app.get(PromotionsService);
  }, 30_000);

  afterEach(async () => {
    await wipe(prisma, bag);
  });

  afterAll(async () => {
    await app.close();
  });

  async function createUser(
    partial: {
      role?: Role;
      grade?: 'TRAINEE' | 'CONDUCTOR';
      brigadeId?: string | null;
      streakDays?: number;
      lastRunAt?: Date | null;
    } = {},
  ) {
    const id = randomUUID();
    const user = await prisma.user.create({
      data: {
        id,
        login: `prog-${id.slice(0, 8)}`,
        passwordHash: 'test-hash',
        role: partial.role ?? Role.CONDUCTOR,
        callsign: callsign(),
        position: 'проводник',
        grade: partial.grade ?? 'TRAINEE',
        brigadeId: partial.brigadeId ?? null,
        streakDays: partial.streakDays ?? 0,
        lastRunAt: partial.lastRunAt ?? null,
      },
    });
    bag.users.push(user.id);
    return user;
  }

  async function createBrigade() {
    const depot = await prisma.depot.create({
      data: { code: `d${randomUUID().slice(0, 8)}`, name: 'Депо', city: 'Москва' },
    });
    bag.depots.push(depot.id);
    const brigade = await prisma.brigade.create({
      data: { code: '12', depotId: depot.id, name: 'Бригада 12' },
    });
    bag.brigades.push(brigade.id);
    return { depot, brigade };
  }

  async function createScenario(category: string, difficulty = 1) {
    const id = `prog-${category}-${randomUUID().slice(0, 8)}`;
    await prisma.scenario.create({
      data: {
        id,
        title: category,
        category,
        carClasses: ['ECONOMY'],
        difficulty,
        competencies: [Competency.safety],
        status: 'PUBLISHED',
      },
    });
    bag.scenarios.push(id);
    return id;
  }

  async function createSession(userId: string, finishedAt: Date) {
    return prisma.gameSession.create({
      data: {
        userId,
        status: 'COMPLETED',
        transport: 'REST',
        plan: {
          train: 'ВСМ 701',
          route: 'Москва — Санкт-Петербург',
          fromStation: 'Москва',
          toStation: 'Санкт-Петербург',
          stops: ['Тверь'],
          car: 4,
          carClass: 'ECONOMY',
          scenarios: [],
        },
        seedCommit: 'ab'.repeat(32),
        seedEnc: 'enc',
        state: {},
        startedAt: new Date(finishedAt.getTime() - 600_000),
        finishedAt,
        expiresAt: new Date(finishedAt.getTime() + 3_600_000),
      },
    });
  }

  function completed(
    userId: string,
    sessionId: string,
    body: RunSummary,
    suspicious = false,
  ): RunCompletedPayload {
    return { runId: randomUUID(), userId, sessionId, summary: body, suspicious };
  }

  it('дважды одно событие пишет один рейс, двигает срок и EWMA', async () => {
    const user = await createUser();
    const scenarioId = await createScenario('service', 2);
    const finishedAt = new Date();
    const session = await createSession(user.id, finishedAt);
    const aliveUntil = new Date(Date.now() + 86_400_000);
    const alive = await prisma.pointLedger.create({
      data: { userId: user.id, amount: 100, reason: 'ADJUST', expiresAt: aliveUntil },
    });
    const deadUntil = new Date(Date.now() - 86_400_000);
    const dead = await prisma.pointLedger.create({
      data: { userId: user.id, amount: 40, reason: 'ADJUST', expiresAt: deadUntil },
    });
    const payload = completed(
      user.id,
      session.id,
      summary({
        loyalty: 80,
        safety: 60,
        competencyDelta: { reaction: 2 },
        decisions: [decision({ scenarioId, verdict: 'ok', stage: 'enroute' })],
      }),
    );

    await recorder.onRunCompleted(payload);
    await recorder.onRunCompleted(payload);

    const runs = await prisma.run.findMany({ where: { sessionId: session.id } });
    expect(runs).toHaveLength(1);
    const storedDecisions = await prisma.runDecision.findMany({
      where: { runId: runs[0]?.id },
      orderBy: { idx: 'asc' },
    });
    expect(storedDecisions).toEqual([
      expect.objectContaining({
        idx: 0,
        scenarioId,
        nodeId: 'n1',
        choiceId: 'look',
        verdict: 'ok',
        stage: 'enroute',
        situation: 'Проверка',
        action: 'Осмотрел',
        gameTime: '09:00',
      }),
    ]);
    expect(runs[0]?.points).toBe(105);
    expect(runs[0]?.playSeconds).toBe(600);
    expect(runs[0]?.outcomeNote).toBe('Рейс завершён');
    expect(runs[0]?.suspicious).toBe(false);
    const runLedger = await prisma.pointLedger.count({
      where: { runId: payload.runId, reason: 'RUN' },
    });
    expect(runLedger).toBe(1);
    const refreshedAlive = await prisma.pointLedger.findUniqueOrThrow({ where: { id: alive.id } });
    const refreshedDead = await prisma.pointLedger.findUniqueOrThrow({ where: { id: dead.id } });
    expect(refreshedAlive.expiresAt?.getTime()).toBeGreaterThan(Date.now() + 20 * 86_400_000);
    expect(refreshedDead.expiresAt?.getTime()).toBe(deadUntil.getTime());
    const score = await prisma.competencyScore.findUniqueOrThrow({
      where: { userId_competency: { userId: user.id, competency: 'reaction' } },
    });
    expect(score.value).toBeCloseTo(54.8);
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.streakDays).toBe(1);
  });

  it('флаг рейса обнуляет очки и не выдаёт знак', async () => {
    const user = await createUser();
    const scenarioId = await createScenario('technical', 1);
    const session = await createSession(user.id, new Date());
    const alive = await prisma.pointLedger.create({
      data: {
        userId: user.id,
        amount: 80,
        reason: 'ADJUST',
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    const payload = completed(
      user.id,
      session.id,
      summary({
        loyalty: 90,
        safety: 90,
        competencyDelta: { service: 1 },
        decisions: [decision({ scenarioId, verdict: 'best', stage: 'acceptance' })],
      }),
      true,
    );

    await recorder.onRunCompleted(payload);

    const run = await prisma.run.findUniqueOrThrow({ where: { sessionId: session.id } });
    expect(run.points).toBe(0);
    expect(run.suspicious).toBe(true);
    expect(run.outcomeNote.toLowerCase()).not.toContain('подозр');
    expect(run.outcomeNote.toLowerCase()).not.toContain('suspicious');
    expect(await prisma.pointLedger.count({ where: { runId: run.id, reason: 'RUN' } })).toBe(0);
    const earned = await prisma.userAchievement.findUnique({
      where: { userId_code: { userId: user.id, code: 'before-boarding' } },
    });
    expect(earned?.earnedAt ?? null).toBeNull();
    const moved = await prisma.pointLedger.findUniqueOrThrow({ where: { id: alive.id } });
    expect(moved.expiresAt?.getTime()).toBeGreaterThan(Date.now() + 20 * 86_400_000);
    const score = await prisma.competencyScore.findUniqueOrThrow({
      where: { userId_competency: { userId: user.id, competency: 'service' } },
    });
    expect(score.value).toBeCloseTo(52.4);
  });

  it('шкала вне 0..100 делает рейс подозрительным и пишет аудит', async () => {
    const user = await createUser();
    const session = await createSession(user.id, new Date());
    const payload = completed(user.id, session.id, summary({ loyalty: 140, safety: 80 }));

    await recorder.onRunCompleted(payload);

    const run = await prisma.run.findUniqueOrThrow({ where: { sessionId: session.id } });
    expect(run.suspicious).toBe(true);
    expect(run.points).toBe(0);
    expect(run.loyalty).toBe(100);
    expect(await prisma.pointLedger.count({ where: { runId: run.id, reason: 'RUN' } })).toBe(0);
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'run.summary.invariant', target: session.id },
    });
    expect(audit?.actorType).toBe('SYSTEM');
    expect(audit?.meta).toMatchObject({ violations: ['loyalty'], loyalty: 140 });
  });

  it('прерванный рейс получает failPoints, а не формулу шкалы', async () => {
    const user = await createUser();
    const session = await createSession(user.id, new Date());
    const payload = completed(
      user.id,
      session.id,
      summary({ outcome: 'terminated', loyalty: 100, safety: 10 }),
    );

    await recorder.onRunCompleted(payload);

    const run = await prisma.run.findUniqueOrThrow({ where: { sessionId: session.id } });
    expect(run.points).toBe(10);
    const ledger = await prisma.pointLedger.findFirstOrThrow({
      where: { runId: run.id, reason: 'RUN' },
    });
    expect(ledger.amount).toBe(10);
  });

  it('серия растёт на следующий московский день и сбрасывается после дыры', async () => {
    const today = moscowNoon(0);
    const continued = await createUser({ streakDays: 3, lastRunAt: moscowNoon(-1) });
    const continuedSession = await createSession(continued.id, today);
    await recorder.onRunCompleted(completed(continued.id, continuedSession.id, summary()));
    expect((await prisma.user.findUniqueOrThrow({ where: { id: continued.id } })).streakDays).toBe(
      4,
    );

    const reset = await createUser({ streakDays: 6, lastRunAt: moscowNoon(-3) });
    const resetSession = await createSession(reset.id, today);
    await recorder.onRunCompleted(completed(reset.id, resetSession.id, summary()));
    expect((await prisma.user.findUniqueOrThrow({ where: { id: reset.id } })).streakDays).toBe(1);

    const same = await createUser({ streakDays: 4, lastRunAt: today });
    const sameSession = await createSession(same.id, new Date(today.getTime() + 2 * 3_600_000));
    await recorder.onRunCompleted(completed(same.id, sameSession.id, summary()));
    expect((await prisma.user.findUniqueOrThrow({ where: { id: same.id } })).streakDays).toBe(4);
  });

  it('рекомендует грейд, когда бонус знака добирает уровень, и не дублирует', async () => {
    const user = await createUser();
    const safetyId = await createScenario('safety');
    const serviceId = await createScenario('service');
    const technicalId = await createScenario('technical');
    await prisma.competencyScore.createMany({
      data: [
        Competency.safety,
        Competency.procedure,
        Competency.detection,
        Competency.reaction,
        Competency.service,
        Competency.escalation,
      ].map((competency) => ({ userId: user.id, competency, value: 45 })),
    });
    await prisma.pointLedger.create({
      data: {
        userId: user.id,
        amount: 400,
        reason: 'RUN',
        expiresAt: new Date(Date.now() + 30 * 86_400_000),
      },
    });
    await prisma.pointLedger.create({
      data: {
        userId: user.id,
        amount: 5000,
        reason: 'ADJUST',
        expiresAt: new Date(Date.now() + 30 * 86_400_000),
      },
    });
    for (const scenarioId of [safetyId, serviceId, safetyId, serviceId]) {
      const session = await createSession(user.id, new Date(Date.now() - 86_400_000));
      const run = await prisma.run.create({
        data: {
          userId: user.id,
          sessionId: session.id,
          train: 'ВСМ 701',
          route: 'Москва — Санкт-Петербург',
          car: 4,
          carClass: 'ECONOMY',
          outcome: 'completed',
          outcomeNote: 'Рейс завершён',
          loyalty: 80,
          safety: 90,
          politeness: 80,
          points: 0,
          playSeconds: 100,
          competencyDelta: {},
          facts: { prevented: 0, incidents: 0, complaints: 0, interventions: 0 },
          suspicious: false,
          finishedAt: session.finishedAt ?? new Date(),
        },
      });
      await prisma.runDecision.create({
        data: {
          runId: run.id,
          idx: 0,
          gameTime: '10:00',
          stage: 'enroute',
          scenarioId,
          nodeId: 'n1',
          choiceId: 'check',
          situation: 'Осмотр',
          action: 'Доложил',
          verdict: 'ok',
          loyaltyDelta: 0,
          safetyDelta: 0,
        },
      });
    }

    await promotions.consider(user.id);
    expect(await prisma.promotionRecommendation.count({ where: { userId: user.id } })).toBe(0);

    const session = await createSession(user.id, new Date());
    const payload = completed(
      user.id,
      session.id,
      summary({
        loyalty: 0,
        safety: 30,
        decisions: [decision({ scenarioId: technicalId, verdict: 'best', stage: 'acceptance' })],
      }),
    );
    await recorder.onRunCompleted(payload);
    await promotions.consider(user.id);

    const rows = await prisma.pointLedger.findMany({ where: { userId: user.id } });
    const asLedger = (
      source: typeof rows,
    ): {
      amount: number;
      reason: (typeof rows)[number]['reason'];
      expiresAt: Date | null;
      expiredAt: Date | null;
    }[] =>
      source.map((row) => ({
        amount: row.amount,
        reason: row.reason,
        expiresAt: row.expiresAt,
        expiredAt: row.expiredAt,
      }));
    expect(lifetimeLevelPoints(asLedger(rows))).toBeGreaterThanOrEqual(450);
    expect(
      lifetimeLevelPoints(asLedger(rows.filter((row) => row.reason !== 'ACHIEVEMENT'))),
    ).toBeLessThan(450);
    const recommendation = await prisma.promotionRecommendation.findFirst({
      where: { userId: user.id, status: 'PENDING' },
    });
    expect(recommendation?.toGrade).toBe('CONDUCTOR');
    expect(await prisma.promotionRecommendation.count({ where: { userId: user.id } })).toBe(1);
    const sign = await prisma.userAchievement.findUnique({
      where: { userId_code: { userId: user.id, code: 'before-boarding' } },
    });
    expect(sign?.earnedAt).toBeTruthy();
  });

  it('список знаков прячет скрытый, пока он не получен, и отдаёт прогресс серии', async () => {
    const today = moscowNoon(0);
    const user = await createUser({ streakDays: 6, lastRunAt: today });
    const scenarioId = await createScenario('service');
    const session = await createSession(user.id, new Date(today.getTime() + 3_600_000));
    const payload = completed(
      user.id,
      session.id,
      summary({ decisions: [decision({ scenarioId, verdict: 'ok', stage: 'enroute' })] }),
    );
    await recorder.onRunCompleted(payload);

    const before = await achievements.listForUser(user.id);
    expect(before.some((card) => card.code === 'seal')).toBe(false);
    expect(before.find((card) => card.code === 'streak')).toMatchObject({
      earnedAt: null,
      progress: { value: 6, total: 7 },
    });

    await prisma.user.update({ where: { id: user.id }, data: { streakDays: 7 } });
    await achievements.onRunRecorded({
      runId: payload.runId,
      userId: user.id,
      brigadeId: null,
      depotId: null,
      points: 0,
      outcome: 'completed',
      suspicious: false,
    });
    const after = await achievements.listForUser(user.id);
    const streak = after.find((card) => card.code === 'streak');
    expect(streak?.earnedAt).toEqual(expect.any(String));
    expect(streak?.progress).toBeUndefined();
    expect(after[0]?.earnedAt).toEqual(expect.any(String));

    const bonuses = await prisma.pointLedger.count({
      where: { userId: user.id, reason: 'ACHIEVEMENT', amount: 70 },
    });
    await achievements.onRunRecorded({
      runId: payload.runId,
      userId: user.id,
      brigadeId: null,
      depotId: null,
      points: 0,
      outcome: 'completed',
      suspicious: false,
    });
    expect(
      await prisma.pointLedger.count({
        where: { userId: user.id, reason: 'ACHIEVEMENT', amount: 70 },
      }),
    ).toBe(bonuses);
  });

  it('начальник видит свою бригаду, администратор — все, решение меняет грейд', async () => {
    const left = await createBrigade();
    const right = await createBrigade();
    const conductor = await createUser({ brigadeId: left.brigade.id });
    const other = await createUser({ brigadeId: right.brigade.id });
    const chief = await createUser({ role: Role.CHIEF, brigadeId: left.brigade.id });
    const admin = await createUser({ role: Role.ADMIN });
    const own = await prisma.promotionRecommendation.create({
      data: {
        userId: conductor.id,
        fromGrade: 'TRAINEE',
        toGrade: 'CONDUCTOR',
        reasons: ['Уровень'],
        status: 'PENDING',
      },
    });
    const foreign = await prisma.promotionRecommendation.create({
      data: {
        userId: other.id,
        fromGrade: 'TRAINEE',
        toGrade: 'CONDUCTOR',
        reasons: ['Уровень'],
        status: 'PENDING',
      },
    });

    const chiefView: AuthUser = {
      id: chief.id,
      role: Role.CHIEF,
      brigadeId: left.brigade.id,
      depotId: left.depot.id,
    };
    const adminView: AuthUser = {
      id: admin.id,
      role: Role.ADMIN,
      brigadeId: null,
      depotId: null,
    };
    const conductorView: AuthUser = {
      id: conductor.id,
      role: Role.CONDUCTOR,
      brigadeId: left.brigade.id,
      depotId: left.depot.id,
    };

    const mine = await inject(app, 'GET', promotionPath('PENDING'), chiefView);
    expect(mine.statusCode).toBe(200);
    expect(mine.json() as unknown[]).toHaveLength(1);

    const all = await inject(app, 'GET', promotionPath(), adminView);
    expect(all.statusCode).toBe(200);
    expect((all.json() as unknown[]).length).toBeGreaterThanOrEqual(2);

    const denied = await inject(app, 'GET', promotionPath('PENDING'), conductorView);
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ code: 'FORBIDDEN' });

    const anon = await inject(app, 'GET', promotionPath('PENDING'));
    expect(anon.statusCode).toBe(401);

    const bad = await inject(app, 'POST', `/api/v1/promotions/${own.id}/decision`, chiefView, {
      approve: 'yes',
    });
    expect(bad.statusCode).toBe(422);

    const forbidden = await inject(
      app,
      'POST',
      `/api/v1/promotions/${foreign.id}/decision`,
      chiefView,
      { approve: true },
    );
    expect(forbidden.statusCode).toBe(403);

    const missing = await inject(
      app,
      'POST',
      `/api/v1/promotions/${randomUUID()}/decision`,
      adminView,
      { approve: true },
    );
    expect(missing.statusCode).toBe(404);

    const approved = await inject(app, 'POST', `/api/v1/promotions/${own.id}/decision`, chiefView, {
      approve: true,
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toMatchObject({ status: 'APPROVED' });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: conductor.id } })).grade).toBe(
      'CONDUCTOR',
    );
    expect(
      await prisma.auditLog.findFirst({
        where: { actorId: chief.id, action: 'promotion.approved', target: own.id },
      }),
    ).toBeTruthy();

    const again = await inject(app, 'POST', `/api/v1/promotions/${own.id}/decision`, adminView, {
      approve: false,
    });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ code: 'PROMOTION_DECIDED' });

    const rejected = await inject(
      app,
      'POST',
      `/api/v1/promotions/${foreign.id}/decision`,
      adminView,
      { approve: false },
    );
    expect(rejected.statusCode).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: other.id } })).grade).toBe(
      'TRAINEE',
    );
    expect(
      await prisma.auditLog.findFirst({
        where: { actorId: admin.id, action: 'promotion.rejected', target: foreign.id },
      }),
    ).toBeTruthy();

    const spec = await inject(app, 'GET', '/api/openapi.json');
    const paths = (spec.json() as { paths: Record<string, unknown> }).paths;
    expect(paths['/api/v1/promotions']).toBeDefined();
    expect(paths['/api/v1/promotions/{id}/decision']).toBeDefined();
  });

  it('начальник не утверждает собственное повышение', async () => {
    const { brigade, depot } = await createBrigade();
    const chief = await createUser({ role: Role.CHIEF, brigadeId: brigade.id });
    const own = await prisma.promotionRecommendation.create({
      data: {
        userId: chief.id,
        fromGrade: 'TRAINEE',
        toGrade: 'CONDUCTOR',
        reasons: ['Уровень'],
        status: 'PENDING',
      },
    });
    const chiefView: AuthUser = {
      id: chief.id,
      role: Role.CHIEF,
      brigadeId: brigade.id,
      depotId: depot.id,
    };
    const denied = await inject(app, 'POST', `/api/v1/promotions/${own.id}/decision`, chiefView, {
      approve: true,
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ code: 'SELF_DECISION' });
    expect(
      (await prisma.promotionRecommendation.findUniqueOrThrow({ where: { id: own.id } })).status,
    ).toBe('PENDING');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: chief.id } })).grade).toBe(
      'TRAINEE',
    );
  });

  it('утверждение не меняет грейд, если HR уже сменил его', async () => {
    const { brigade, depot } = await createBrigade();
    const conductor = await createUser({
      role: Role.CONDUCTOR,
      brigadeId: brigade.id,
      grade: 'CONDUCTOR',
    });
    const chief = await createUser({ role: Role.CHIEF, brigadeId: brigade.id });
    const row = await prisma.promotionRecommendation.create({
      data: {
        userId: conductor.id,
        fromGrade: 'TRAINEE',
        toGrade: 'CONDUCTOR',
        reasons: ['Уровень'],
        status: 'PENDING',
      },
    });
    const chiefView: AuthUser = {
      id: chief.id,
      role: Role.CHIEF,
      brigadeId: brigade.id,
      depotId: depot.id,
    };
    const denied = await inject(app, 'POST', `/api/v1/promotions/${row.id}/decision`, chiefView, {
      approve: true,
    });
    expect(denied.statusCode).toBe(409);
    expect(denied.json()).toMatchObject({ code: 'GRADE_CHANGED' });
    expect(
      (await prisma.promotionRecommendation.findUniqueOrThrow({ where: { id: row.id } })).status,
    ).toBe('PENDING');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: conductor.id } })).grade).toBe(
      'CONDUCTOR',
    );
  });

  it('сбой слушателя не роняет ход и чинится сверкой без второго начисления', async () => {
    const user = await createUser();
    const session = await createSession(user.id, new Date());
    const payload = completed(user.id, session.id, summary());
    const emitter = app.get(EventEmitter2);
    const fail = (): never => {
      throw new Error('эффект сломался');
    };
    emitter.on(RUN_RECORDED, fail, { promisify: true });
    try {
      await expect(recorder.onRunCompleted(payload)).resolves.toBeUndefined();
      const run = await prisma.run.findUniqueOrThrow({ where: { id: payload.runId } });
      expect(run.points).toBeGreaterThan(0);
      expect(run.effectsAt).toBeNull();
      expect(
        await prisma.pointLedger.count({ where: { runId: payload.runId, reason: 'RUN' } }),
      ).toBe(1);
    } finally {
      emitter.off(RUN_RECORDED, fail);
    }
    await recorder.reconcileEffects(new Date(Date.now() + 120_000));
    const fixed = await prisma.run.findUniqueOrThrow({ where: { id: payload.runId } });
    expect(fixed.effectsAt).not.toBeNull();
    expect(await prisma.pointLedger.count({ where: { runId: payload.runId, reason: 'RUN' } })).toBe(
      1,
    );
  });

  it('одобрение подозрительного рейса начисляет очки и рейтинг один раз', async () => {
    const { brigade, depot } = await createBrigade();
    const conductor = await createUser({ brigadeId: brigade.id });
    const chief = await createUser({ role: Role.CHIEF, brigadeId: brigade.id });
    const other = await createBrigade();
    const foreignChief = await createUser({ role: Role.CHIEF, brigadeId: other.brigade.id });
    const admin = await createUser({ role: Role.ADMIN });
    const scenarioId = await createScenario('service', 2);
    const session = await createSession(conductor.id, new Date());
    const payload = completed(
      conductor.id,
      session.id,
      summary({
        loyalty: 80,
        safety: 60,
        decisions: [decision({ scenarioId, verdict: 'ok', stage: 'enroute' })],
      }),
      true,
    );
    await recorder.onRunCompleted(payload);
    const redis = app.get(RedisService);
    expect(await redis.get(appliedRunKey(payload.runId))).toBe('skip');

    const chiefView: AuthUser = {
      id: chief.id,
      role: Role.CHIEF,
      brigadeId: brigade.id,
      depotId: depot.id,
    };
    const foreignView: AuthUser = {
      id: foreignChief.id,
      role: Role.CHIEF,
      brigadeId: other.brigade.id,
      depotId: other.depot.id,
    };
    const adminView: AuthUser = {
      id: admin.id,
      role: Role.ADMIN,
      brigadeId: null,
      depotId: null,
    };
    const selfView: AuthUser = {
      id: chief.id,
      role: Role.CHIEF,
      brigadeId: brigade.id,
      depotId: depot.id,
    };

    const queue = await inject(app, 'GET', '/api/v1/runs/suspicious', chiefView);
    expect(queue.statusCode).toBe(200);
    expect(queue.json()).toEqual([
      expect.objectContaining({ id: payload.runId, userId: conductor.id }),
    ]);
    const foreignQueue = await inject(app, 'GET', '/api/v1/runs/suspicious', foreignView);
    expect(foreignQueue.json()).toEqual([]);

    const forbidden = await inject(
      app,
      'POST',
      `/api/v1/runs/${payload.runId}/review`,
      foreignView,
      {
        approve: true,
      },
    );
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json()).toMatchObject({ code: 'FORBIDDEN' });

    const ownSession = await createSession(chief.id, new Date());
    const ownPayload = completed(chief.id, ownSession.id, summary(), true);
    await recorder.onRunCompleted(ownPayload);
    const ownDenied = await inject(
      app,
      'POST',
      `/api/v1/runs/${ownPayload.runId}/review`,
      selfView,
      {
        approve: true,
      },
    );
    expect(ownDenied.statusCode).toBe(403);
    expect(ownDenied.json()).toMatchObject({ code: 'SELF_DECISION' });

    const bystander = await createUser({ brigadeId: brigade.id });
    const cleanSession = await createSession(bystander.id, new Date());
    const clean = completed(bystander.id, cleanSession.id, summary());
    await recorder.onRunCompleted(clean);
    const notFlagged = await inject(app, 'POST', `/api/v1/runs/${clean.runId}/review`, chiefView, {
      approve: true,
    });
    expect(notFlagged.statusCode).toBe(409);
    expect(notFlagged.json()).toMatchObject({ code: 'RUN_NOT_SUSPICIOUS' });

    const approved = await inject(app, 'POST', `/api/v1/runs/${payload.runId}/review`, chiefView, {
      approve: true,
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toMatchObject({
      id: payload.runId,
      suspicious: false,
      reviewApproved: true,
      points: 105,
    });
    const run = await prisma.run.findUniqueOrThrow({ where: { id: payload.runId } });
    expect(run.points).toBe(105);
    expect(run.suspicious).toBe(false);
    expect(run.effectsAt).not.toBeNull();
    expect(await prisma.pointLedger.count({ where: { runId: payload.runId, reason: 'RUN' } })).toBe(
      1,
    );
    const season = await prisma.season.findFirst({ orderBy: { startsAt: 'desc' } });
    expect(season).toBeTruthy();
    const score = await prisma.seasonScore.findUniqueOrThrow({
      where: { seasonId_userId: { seasonId: season?.id ?? '', userId: conductor.id } },
    });
    expect(score.points).toBe(105);
    expect(await redis.zscore(companyBoardKey(season?.id ?? ''), conductor.id)).toBe('105');
    expect(
      await prisma.auditLog.findFirst({
        where: { actorId: chief.id, action: 'run.review.approved', target: payload.runId },
      }),
    ).toBeTruthy();

    const again = await inject(app, 'POST', `/api/v1/runs/${payload.runId}/review`, adminView, {
      approve: true,
    });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ code: 'RUN_REVIEWED' });
    expect(await prisma.pointLedger.count({ where: { runId: payload.runId, reason: 'RUN' } })).toBe(
      1,
    );
    const scoreAgain = await prisma.seasonScore.findUniqueOrThrow({
      where: { seasonId_userId: { seasonId: season?.id ?? '', userId: conductor.id } },
    });
    expect(scoreAgain.points).toBe(105);

    const after = await inject(app, 'GET', '/api/v1/runs/suspicious', adminView);
    const ids = (after.json() as { id: string }[]).map((row) => row.id);
    expect(ids).not.toContain(payload.runId);
  });

  it('отклонение подозрительного рейса не начисляет очки', async () => {
    const { brigade, depot } = await createBrigade();
    const conductor = await createUser({ brigadeId: brigade.id });
    const chief = await createUser({ role: Role.CHIEF, brigadeId: brigade.id });
    const session = await createSession(conductor.id, new Date());
    const payload = completed(conductor.id, session.id, summary({ loyalty: 90, safety: 90 }), true);
    await recorder.onRunCompleted(payload);
    const chiefView: AuthUser = {
      id: chief.id,
      role: Role.CHIEF,
      brigadeId: brigade.id,
      depotId: depot.id,
    };
    const rejected = await inject(app, 'POST', `/api/v1/runs/${payload.runId}/review`, chiefView, {
      approve: false,
    });
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json()).toMatchObject({ reviewApproved: false, suspicious: true, points: 0 });
    expect(await prisma.pointLedger.count({ where: { runId: payload.runId, reason: 'RUN' } })).toBe(
      0,
    );
    expect(await prisma.seasonScore.count({ where: { userId: conductor.id } })).toBe(0);
    const again = await inject(app, 'POST', `/api/v1/runs/${payload.runId}/review`, chiefView, {
      approve: true,
    });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ code: 'RUN_REVIEWED' });
    const spec = await inject(app, 'GET', '/api/openapi.json');
    const paths = (spec.json() as { paths: Record<string, unknown> }).paths;
    expect(paths['/api/v1/runs/suspicious']).toBeDefined();
    expect(paths['/api/v1/runs/{id}/review']).toBeDefined();
  });
});

type HttpResult = {
  statusCode: number;
  json: () => unknown;
};

function promotionPath(status?: string): string {
  const base = '/api/v1/promotions';
  if (!status) {
    return base;
  }
  return `${base}?status=${status}`;
}

async function inject(
  app: NestFastifyApplication,
  method: 'GET' | 'POST',
  url: string,
  actor?: AuthUser,
  payload?: Record<string, unknown>,
): Promise<HttpResult> {
  const headers: Record<string, string> = {};
  if (actor) {
    headers['x-test-user'] = JSON.stringify(actor);
  }
  if (payload !== undefined) {
    headers['content-type'] = 'application/json';
  }
  const response = await app
    .getHttpAdapter()
    .getInstance()
    .inject({ method, url, headers, payload });
  return response as unknown as HttpResult;
}

async function wipe(prisma: PrismaService, bag: Bag): Promise<void> {
  if (bag.users.length > 0) {
    const users = bag.users;
    await prisma.auditLog.deleteMany({ where: { actorId: { in: users } } });
    await prisma.promotionRecommendation.deleteMany({
      where: { OR: [{ userId: { in: users } }, { decidedById: { in: users } }] },
    });
    await prisma.notification.deleteMany({ where: { userId: { in: users } } });
    await prisma.seasonScore.deleteMany({ where: { userId: { in: users } } });
    await prisma.pointLedger.deleteMany({ where: { userId: { in: users } } });
    await prisma.runDecision.deleteMany({ where: { run: { userId: { in: users } } } });
    await prisma.run.deleteMany({ where: { userId: { in: users } } });
    await prisma.gameSession.deleteMany({ where: { userId: { in: users } } });
    await prisma.competencyScore.deleteMany({ where: { userId: { in: users } } });
    await prisma.userAchievement.deleteMany({ where: { userId: { in: users } } });
    await prisma.notification.deleteMany({ where: { userId: { in: users } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  }
  if (bag.brigades.length > 0) {
    await prisma.brigade.deleteMany({ where: { id: { in: bag.brigades } } });
  }
  if (bag.depots.length > 0) {
    await prisma.depot.deleteMany({ where: { id: { in: bag.depots } } });
  }
  if (bag.scenarios.length > 0) {
    await prisma.scenario.deleteMany({ where: { id: { in: bag.scenarios } } });
  }
  bag.users = [];
  bag.brigades = [];
  bag.depots = [];
  bag.scenarios = [];
}
