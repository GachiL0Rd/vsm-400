import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HeaderAccessGuard } from '../../test/header-access.guard';
import { AppModule } from '../app.module';
import { AccessGuard } from '../auth/access.guard';
import type { AuthUser } from '../auth/auth-user';
import { ASSIGNMENT_CREATED, type AssignmentCreatedPayload } from '../common/events';
import { configureApp } from '../configure-app';
import { PrismaService } from '../prisma/prisma.service';

const PROFILE_KEYS = [
  'brigade',
  'callsign',
  'competencies',
  'depot',
  'expiring',
  'grade',
  'level',
  'levelFrom',
  'levelTo',
  'points',
  'position',
  'streakDays',
  'trend',
  'weakNote',
].sort();

const STATS_KEYS = [
  'avgReactionSec',
  'completed',
  'defectsFound',
  'escalationsCorrect',
  'escalationsTotal',
  'incidents',
  'luckyViolations',
  'missedChecks',
  'runs',
  'terminated',
].sort();

const SHIFT_KEYS = [
  'car',
  'carClass',
  'departure',
  'departureAt',
  'focus',
  'from',
  'fromGenitive',
  'stops',
  'to',
  'train',
].sort();

const RUN_KEYS = [
  'car',
  'carClass',
  'competencyDelta',
  'facts',
  'finishedAt',
  'id',
  'loyalty',
  'outcome',
  'outcomeNote',
  'playMinutes',
  'points',
  'route',
  'safety',
  'train',
].sort();

const DECISION_KEYS = [
  'action',
  'id',
  'loyalty',
  'safety',
  'situation',
  'stage',
  'time',
  'verdict',
];

type Actor = AuthUser;

function readEnv(name: string): string {
  const line = readFileSync('.env', 'utf8')
    .split('\n')
    .find((item) => item.startsWith(`${name}=`));
  if (!line) {
    throw new Error(`в .env нет ${name}`);
  }
  return line.slice(name.length + 1).trim();
}

function callsign(): string {
  const bytes = randomBytes(4);
  const chars = ['A', 'A', 'A', 'A'];
  for (let index = 0; index < 4; index += 1) {
    const byte = bytes[index] ?? 0;
    chars[index] = String.fromCharCode(65 + (byte % 26));
  }
  return chars.join('');
}

function actor(
  id: string,
  role: Actor['role'],
  brigadeId: string | null,
  depotId: string | null,
): Actor {
  return { id, role, brigadeId, depotId };
}

describe('кабинет, аналитика, назначения', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  const seen: AssignmentCreatedPayload[] = [];
  const userIds: string[] = [];
  const scenarioIds: string[] = [];
  let depotId = '';
  let brigadeA = '';
  let brigadeB = '';
  let conductor: Actor;
  let second: Actor;
  let chief: Actor;
  let otherChief: Actor;
  let methodist: Actor;
  let ownRunId = '';
  let foreignRunId = '';
  let escId = '';
  let serviceId = '';
  let draftId = '';
  let earnedCode = '';
  let openCode = '';
  let hiddenCode = '';
  let expiringAt = '';
  let mainCallsign = '';

  beforeAll(async () => {
    // Своя база: параллельный sync сценариев в общую vsm ловит гонку по версии.
    process.env.DATABASE_URL = readEnv('DATABASE_URL').replace(/\/[^/]+$/, '/vsm_cabinet');
    process.env.REDIS_URL = readEnv('REDIS_URL');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AccessGuard)
      .useClass(HeaderAccessGuard)
      .compile();
    app = moduleRef.createNestApplication(adapter(), { logger: false });
    appRef = app;
    await configureApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    prisma = app.get(PrismaService);
    app.get(EventEmitter2).on(ASSIGNMENT_CREATED, (payload: AssignmentCreatedPayload) => {
      seen.push(payload);
    });
    await seed();
  }, 60_000);

  afterAll(async () => {
    if (prisma) {
      await wipe();
    }
    if (app) {
      await app.close();
    }
  }, 60_000);

  it('профиль совпадает с полями кабинета, уровень и баллы разные', async () => {
    const response = await call('GET', '/api/v1/me', conductor);
    expect(response.statusCode).toBe(200);
    const body = response.json() as ProfileBody;
    expect(Object.keys(body).sort()).toEqual(PROFILE_KEYS);
    expect(body.brigade).toBe('12');
    expect(body.depot).toBe('Депо');
    expect(body.grade).toBe('CONDUCTOR');
    expect(body.streakDays).toBe(6);
    expect(body.level).toBe(7);
    expect(body.levelFrom).toBe(2000);
    expect(body.levelTo).toBe(3000);
    expect(body.points).toBe(2150);
    expect(body.expiring).toEqual({ points: 2000, at: expiringAt });
    expect(body.competencies.escalation).toBe(40);
    expect(body.competencies.reaction).toBe(50);
    expect(body.trend.detection).toBe(10);
    expect(body.weakNote.escalation).toBe('В 3 из 5 последних рейсов доклад ушёл позже жалобы.');
    expect(body.weakNote.detection).toBe(
      'Растёт: 2 неисправности найдены детальным осмотром на приёмке.',
    );
    expect(body.weakNote.safety).toBeUndefined();
  });

  it('статистика считает вердикты', async () => {
    const response = await call('GET', '/api/v1/me/stats', conductor);
    expect(response.statusCode).toBe(200);
    const body = response.json() as Record<string, number>;
    expect(Object.keys(body).sort()).toEqual(STATS_KEYS);
    expect(body).toMatchObject({
      runs: 6,
      completed: 4,
      incidents: 1,
      terminated: 1,
      defectsFound: 2,
      missedChecks: 2,
      avgReactionSec: 7.5,
      escalationsCorrect: 2,
      escalationsTotal: 6,
      luckyViolations: 1,
    });
  });

  it('без назначения смена — прогноз по слабым компетенциям', async () => {
    const response = await call('GET', '/api/v1/me/next-shift', conductor);
    expect(response.statusCode).toBe(200);
    const body = response.json() as ShiftBody;
    expect(Object.keys(body).sort()).toEqual(SHIFT_KEYS);
    expect(body.focus).toEqual(['escalation', 'reaction']);
    expect(body.departure).toMatch(/^\d{2}:\d{2}$/);
    expect(body.stops).toEqual(
      expect.arrayContaining(['Тверь', 'Вышний Волочёк', 'Бологое', 'Чудово']),
    );
    expect(new Date(body.departureAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('прошедший PLANNED не подменяет следующую смену', async () => {
    const created = await call('POST', '/api/v1/assignments', chief, {
      userIds: [conductor.id],
      scenarioIds: [escId],
      departureAt: '2020-01-01T06:30:00.000Z',
    });
    expect(created.statusCode).toBe(201);
    const row = (created.json() as { assignments: { id: string }[] }).assignments[0];
    const next = await call('GET', '/api/v1/me/next-shift', conductor);
    const body = next.json() as ShiftBody;
    expect(next.statusCode).toBe(200);
    expect(body.departureAt.startsWith('2020-')).toBe(false);
    expect(new Date(body.departureAt).getTime()).toBeGreaterThan(Date.now());
    if (row) {
      const removed = await call('DELETE', `/api/v1/assignments/${row.id}`, chief);
      expect(removed.statusCode).toBe(200);
    }
  });

  it('журнал отдаёт total и страницу без decisions', async () => {
    const first = await call('GET', '/api/v1/me/runs?limit=2', conductor);
    expect(first.statusCode).toBe(200);
    const page = first.json() as {
      total: number;
      runs: Record<string, unknown>[];
      nextCursor: string;
    };
    expect(page.total).toBe(6);
    expect(page.runs).toHaveLength(2);
    expect(Object.keys(page.runs[0] ?? {}).sort()).toEqual(RUN_KEYS);
    expect(page.runs[0]).not.toHaveProperty('decisions');
    const ids = await collectRunIds(page.nextCursor);
    expect(new Set(ids).size).toBe(6);
  });

  it('разбор своего рейса и 404 на чужой', async () => {
    const own = await call('GET', `/api/v1/me/runs/${ownRunId}`, conductor);
    expect(own.statusCode).toBe(200);
    const body = own.json() as RunBody;
    expect(Object.keys(body).sort()).toEqual([...RUN_KEYS, 'decisions'].sort());
    expect(body.playMinutes).toBe(38);
    expect(body.carClass).toBe('Бизнес');
    expect(body.facts).toEqual({ prevented: 2, incidents: 0, complaints: 0, interventions: 1 });
    expect(body.decisions).toHaveLength(3);
    const first = body.decisions[0];
    expect(first).toBeDefined();
    if (!first) {
      return;
    }
    for (const key of DECISION_KEYS) {
      expect(first).toHaveProperty(key);
    }
    expect(first).not.toHaveProperty('gameTime');
    expect(first).not.toHaveProperty('loyaltyDelta');
    expect(first.time).toBe('09:34');
    expect(first.loyalty).toBe(-4);
    expect(first.reactionSec).toBe(4);

    const foreign = await call('GET', `/api/v1/me/runs/${foreignRunId}`, conductor);
    expect(foreign.statusCode).toBe(404);
    expect(foreign.headers['content-type']).toContain('application/problem+json');
    expect(foreign.json()).toMatchObject({ code: 'NOT_FOUND' });

    const owner = await call('GET', `/api/v1/me/runs/${foreignRunId}`, otherChief);
    expect(owner.statusCode).toBe(200);
  });

  it('знаки: полученный, прогресс, скрытый без выдачи не виден', async () => {
    const response = await call('GET', '/api/v1/me/achievements', conductor);
    expect(response.statusCode).toBe(200);
    const rows = response.json() as {
      code: string;
      earnedAt: string | null;
      progress?: { value: number; total: number };
    }[];
    const earned = rows.find((row) => row.code === earnedCode);
    const open = rows.find((row) => row.code === openCode);
    expect(earned?.earnedAt).toEqual(expect.any(String));
    expect(open?.earnedAt).toBeNull();
    expect(open?.progress).toEqual({ value: 2, total: 5 });
    expect(rows.some((row) => row.code === hiddenCode)).toBe(false);
  });

  it('сравнение с бригадой и депо и место по несгоревшим баллам', async () => {
    const response = await call('GET', '/api/v1/me/compare', conductor);
    expect(response.statusCode).toBe(200);
    const body = response.json() as CompareBody;
    expect(body.days).toBe(30);
    expect(body.me.brigadeRank).toBe(1);
    expect(body.me.brigadeSize).toBe(3);
    expect(body.me.loyalty).toBe(80);
    expect(body.brigade?.competencies.escalation).toBe(40);
    expect(body.depot?.competencies.escalation).toBe(43);
    expect(body.brigade?.safety).toBe(90);
    expect(body.depot?.safety).toBe(90);
  });

  it('без пользователя 401', async () => {
    const response = await call('GET', '/api/v1/me');
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('начальник назначает свою бригаду, чужую — 403', async () => {
    seen.length = 0;
    const created = await call('POST', '/api/v1/assignments', chief, {
      userIds: [conductor.id],
      scenarioIds: [escId],
      departureAt: '2026-10-01T06:30:00.000Z',
      focus: ['safety'],
    });
    expect(created.statusCode).toBe(201);
    const row = (created.json() as { assignments: ShiftBody[] }).assignments[0];
    expect(row).toBeDefined();
    if (!row) {
      return;
    }
    expect(row.departure).toBe('09:30');
    expect(row.focus).toEqual(['safety']);
    expect(row.carClass).toBeTruthy();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      userId: conductor.id,
      assignedById: chief.id,
      scenarioIds: [escId],
    });

    const next = await call('GET', '/api/v1/me/next-shift', conductor);
    expect(next.json()).toMatchObject({
      train: row.train,
      from: row.from,
      to: row.to,
      departure: '09:30',
      focus: ['safety'],
    });

    const denied = await call('POST', '/api/v1/assignments', otherChief, {
      userIds: [conductor.id],
      scenarioIds: [escId],
      departureAt: '2026-10-02T06:30:00.000Z',
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ code: 'FORBIDDEN_BRIGADE' });
  });

  it('методист видит бригаду, чужой начальник нет', async () => {
    const created = await call('POST', '/api/v1/assignments', methodist, {
      userIds: [conductor.id, second.id],
      scenarioIds: [escId],
      departureAt: '2026-11-01T06:30:00.000Z',
    });
    expect(created.statusCode).toBe(201);
    expect((created.json() as { assignments: unknown[] }).assignments).toHaveLength(2);

    const allowed = await call('GET', `/api/v1/assignments?brigadeId=${brigadeA}`, methodist);
    expect(allowed.statusCode).toBe(200);
    expect((allowed.json() as { assignments: unknown[] }).assignments).toHaveLength(3);

    const denied = await call('GET', `/api/v1/assignments?brigadeId=${brigadeA}`, otherChief);
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ code: 'FORBIDDEN_BRIGADE' });

    const heatmapDenied = await call(
      'GET',
      `/api/v1/analytics/brigades/${brigadeB}/heatmap`,
      chief,
    );
    expect(heatmapDenied.statusCode).toBe(403);
    expect(heatmapDenied.headers['content-type']).toContain('application/problem+json');

    const conductorDenied = await call(
      'GET',
      `/api/v1/analytics/brigades/${brigadeA}/heatmap`,
      conductor,
    );
    expect(conductorDenied.statusCode).toBe(403);
    expect(conductorDenied.json()).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('теплокарта, просадки и воронка', async () => {
    const heatmap = await call('GET', `/api/v1/analytics/brigades/${brigadeA}/heatmap`, methodist);
    expect(heatmap.statusCode).toBe(200);
    const map = heatmap.json() as {
      code: string;
      members: {
        callsign: string;
        competencies: { escalation: { value: number; weak: boolean } };
      }[];
    };
    expect(map.code).toBe('12');
    const me = map.members.find((member) => member.callsign === mainCallsign);
    expect(me?.competencies.escalation).toEqual({ value: 40, weak: true });

    const gaps = await call('GET', `/api/v1/analytics/brigades/${brigadeA}/gaps`, chief);
    expect(gaps.statusCode).toBe(200);
    const report = gaps.json() as GapsBody;
    expect(report.timeouts).toBe(1);
    expect(report.decisions).toBe(9);
    expect(report.timeoutShare).toBe(0.1111);
    expect(report.weak.some((item) => item.competency === 'escalation')).toBe(true);
    expect(report.recommendations.some((item) => item.scenarioId === escId)).toBe(true);
    expect(report.recommendations.some((item) => item.scenarioId === draftId)).toBe(false);
    expect(report.recommendations.some((item) => item.scenarioId === serviceId)).toBe(false);
    expect(report.hotspots[0]).toMatchObject({ scenarioId: escId, nodeId: 'n1', errors: 5 });

    const funnelDenied = await call('GET', `/api/v1/analytics/scenarios/${escId}`, chief);
    expect(funnelDenied.statusCode).toBe(403);

    const funnel = await call('GET', `/api/v1/analytics/scenarios/${escId}`, methodist);
    expect(funnel.statusCode).toBe(200);
    const flow = funnel.json() as {
      decisions: number;
      nodes: { choices: { choiceId: string; count: number }[] }[];
    };
    expect(flow.decisions).toBe(9);
    const late = flow.nodes[0]?.choices.find((choice) => choice.choiceId === 'late');
    expect(late?.count).toBe(3);
  });

  it('отмена назначения: чужая бригада 403, своя ставит CANCELLED', async () => {
    const list = await call('GET', '/api/v1/assignments', chief);
    const rows = (
      list.json() as { assignments: { id: string; userId: string; departureAt: string }[] }
    ).assignments;
    const target = rows.find((row) => row.departureAt.startsWith('2026-10-01'));
    expect(target).toBeDefined();
    if (!target) {
      return;
    }
    const denied = await call('DELETE', `/api/v1/assignments/${target.id}`, otherChief);
    expect(denied.statusCode).toBe(403);
    const removed = await call('DELETE', `/api/v1/assignments/${target.id}`, chief);
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toMatchObject({ status: 'CANCELLED' });
    const after = await call('GET', '/api/v1/assignments', chief);
    const left = (after.json() as { assignments: { id: string }[] }).assignments;
    expect(left.some((row) => row.id === target.id)).toBe(false);
  });

  it('openapi содержит ручки кабинета', async () => {
    const response = await call('GET', '/api/openapi.json', conductor);
    expect(response.statusCode).toBe(200);
    const document = response.json() as {
      paths: Record<string, unknown>;
      components?: { schemas?: Record<string, unknown> };
    };
    expect(document.paths['/api/v1/me']).toBeDefined();
    expect(document.paths['/api/v1/analytics/brigades/{id}/heatmap']).toBeDefined();
    expect(document.paths['/api/v1/assignments']).toBeDefined();
    const profile = JSON.stringify(document.components?.schemas?.Profile_Output ?? {});
    const shift = JSON.stringify(document.components?.schemas?.NextShift_Output ?? {});
    expect(profile).toContain('"nullable":true');
    expect(profile).not.toContain('"type":"null"');
    expect(shift).toContain('departureAt');
  });

  async function collectRunIds(cursor: string): Promise<string[]> {
    const ids: string[] = [];
    let next: string | null = cursor;
    const first = await call('GET', '/api/v1/me/runs?limit=2', conductor);
    for (const run of (first.json() as { runs: { id: string }[] }).runs) {
      ids.push(run.id);
    }
    while (next) {
      const response = await call(
        'GET',
        `/api/v1/me/runs?limit=2&cursor=${encodeURIComponent(next)}`,
        conductor,
      );
      expect(response.statusCode).toBe(200);
      const page = response.json() as { runs: { id: string }[]; nextCursor: string | null };
      for (const run of page.runs) {
        ids.push(run.id);
      }
      next = page.nextCursor;
    }
    return ids;
  }

  async function seed(): Promise<void> {
    const tag = randomBytes(3).toString('hex');
    const now = Date.now();
    const soon = new Date(now + 2 * 86_400_000);
    expiringAt = soon.toISOString();
    const later = new Date(now + 10 * 86_400_000);
    const past = new Date(now - 86_400_000);
    const depot = await prisma.depot.create({
      data: { code: `c${tag}`, name: 'Депо', city: 'Москва' },
    });
    depotId = depot.id;
    const firstBrigade = await prisma.brigade.create({
      data: { code: '12', name: 'Смена 12', depotId: depot.id },
    });
    const secondBrigade = await prisma.brigade.create({
      data: { code: '13', name: 'Смена 13', depotId: depot.id },
    });
    brigadeA = firstBrigade.id;
    brigadeB = secondBrigade.id;
    const chiefUser = await makeUser('CHIEF', firstBrigade.id, 'Начальник поезда');
    const otherUser = await makeUser('CHIEF', secondBrigade.id, 'Начальник поезда');
    const methodistUser = await makeUser('METHODIST', null, 'Методист');
    const mainUser = await makeUser('CONDUCTOR', firstBrigade.id, 'Проводник', 6);
    const secondUser = await makeUser('CONDUCTOR', firstBrigade.id, 'Проводник');
    mainCallsign = mainUser.callsign;
    chief = actor(chiefUser.id, 'CHIEF', brigadeA, depot.id);
    otherChief = actor(otherUser.id, 'CHIEF', brigadeB, depot.id);
    methodist = actor(methodistUser.id, 'METHODIST', null, null);
    conductor = actor(mainUser.id, 'CONDUCTOR', brigadeA, depot.id);
    second = actor(secondUser.id, 'CONDUCTOR', brigadeA, depot.id);

    await prisma.competencyScore.createMany({
      data: [
        score(mainUser.id, 'escalation', 40),
        score(mainUser.id, 'detection', 70),
        score(mainUser.id, 'procedure', 75),
        score(mainUser.id, 'service', 85),
        score(mainUser.id, 'safety', 90),
        score(secondUser.id, 'escalation', 30),
      ],
    });
    await prisma.pointLedger.createMany({
      data: [
        grant(mainUser.id, 2000, 'RUN', soon, null),
        grant(mainUser.id, 340, 'RUN', past, past),
        grant(mainUser.id, 100, 'ACHIEVEMENT', later, null),
        grant(mainUser.id, 50, 'CHALLENGE', later, null),
        grant(mainUser.id, -340, 'EXPIRE', null, null),
      ],
    });

    escId = `esc-${tag}`;
    serviceId = `svc-${tag}`;
    draftId = `draft-${tag}`;
    scenarioIds.push(escId, serviceId, draftId);
    await prisma.scenario.create({
      data: {
        id: escId,
        title: 'Доклад',
        category: 'safety',
        carClasses: ['BUSINESS'],
        difficulty: 2,
        competencies: ['escalation'],
        status: 'PUBLISHED',
        currentVersion: 1,
        versions: { create: { version: 1, graph: GRAPH, checksum: 'cabinet' } },
      },
    });
    await prisma.scenario.create({
      data: {
        id: serviceId,
        title: 'Сервис',
        category: 'service',
        carClasses: ['ECONOMY'],
        difficulty: 1,
        competencies: ['service'],
        status: 'PUBLISHED',
        currentVersion: 1,
        versions: { create: { version: 1, graph: {}, checksum: 'cabinet' } },
      },
    });
    await prisma.scenario.create({
      data: {
        id: draftId,
        title: 'Черновик',
        category: 'safety',
        carClasses: ['ECONOMY'],
        difficulty: 1,
        competencies: ['escalation'],
        status: 'DRAFT',
        currentVersion: 1,
        versions: { create: { version: 1, graph: {}, checksum: 'cabinet' } },
      },
    });

    earnedCode = 'handover';
    openCode = 'detail';
    hiddenCode = 'seal';
    await prisma.userAchievement.upsert({
      where: { userId_code: { userId: mainUser.id, code: earnedCode } },
      create: { userId: mainUser.id, code: earnedCode, progress: 1, earnedAt: past },
      update: { progress: 1, earnedAt: past },
    });
    await prisma.userAchievement.upsert({
      where: { userId_code: { userId: mainUser.id, code: openCode } },
      create: { userId: mainUser.id, code: openCode, progress: 2, earnedAt: null },
      update: { progress: 2, earnedAt: null },
    });

    scenarioForDecisions = escId;
    ownRunId = await makeRuns(mainUser.id, now);
    foreignRunId = await makeForeign(otherUser.id, now);
  }

  async function makeUser(
    role: Actor['role'],
    brigade: string | null,
    position: string,
    streakDays = 0,
  ): Promise<{ id: string; callsign: string }> {
    const sign = callsign();
    const user = await prisma.user.create({
      data: {
        login: `cab-${randomBytes(4).toString('hex')}`,
        passwordHash: 'hash',
        role,
        callsign: sign,
        position,
        grade: 'CONDUCTOR',
        brigadeId: brigade,
        streakDays,
      },
    });
    userIds.push(user.id);
    return { id: user.id, callsign: sign };
  }

  async function makeRuns(userId: string, now: number): Promise<string> {
    let firstId = '';
    for (let index = 0; index < 6; index += 1) {
      const session = await prisma.gameSession.create({ data: sessionData(userId, now) });
      const run = await prisma.run.create({
        data: {
          userId,
          sessionId: session.id,
          train: 'ВСМ 703',
          route: 'Москва → Санкт-Петербург',
          car: 4,
          carClass: 'BUSINESS',
          outcome: outcomeFor(index),
          outcomeNote: 'Разбор',
          loyalty: 80,
          safety: 90,
          politeness: 70,
          points: 10,
          playSeconds: index === 0 ? 38 * 60 : 600,
          competencyDelta: index < 5 ? { detection: 2 } : { detection: 100 },
          facts:
            index === 0
              ? { prevented: 2, incidents: 0, complaints: 0, interventions: 1 }
              : { prevented: 0, incidents: 0, complaints: 0, interventions: 0 },
          finishedAt: new Date(now - (index + 1) * 86_400_000),
          decisions: { create: decisionsFor(index) },
        },
      });
      if (index === 0) {
        firstId = run.id;
      }
    }
    return firstId;
  }

  async function makeForeign(userId: string, now: number): Promise<string> {
    const session = await prisma.gameSession.create({ data: sessionData(userId, now) });
    const run = await prisma.run.create({
      data: {
        userId,
        sessionId: session.id,
        train: 'ВСМ 710',
        route: 'Санкт-Петербург → Москва',
        car: 1,
        carClass: 'ECONOMY',
        outcome: 'completed',
        outcomeNote: 'Чужой',
        loyalty: 10,
        safety: 10,
        politeness: 10,
        points: 1,
        playSeconds: 60,
        competencyDelta: {},
        facts: { prevented: 0, incidents: 0, complaints: 0, interventions: 0 },
        finishedAt: new Date(now - 40 * 86_400_000),
      },
    });
    return run.id;
  }

  async function wipe(): Promise<void> {
    if (userIds.length > 0) {
      await prisma.runDecision.deleteMany({ where: { run: { userId: { in: userIds } } } });
      await prisma.pointLedger.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.run.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.gameSession.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.shiftAssignment.deleteMany({
        where: { OR: [{ userId: { in: userIds } }, { assignedById: { in: userIds } }] },
      });
      await prisma.userAchievement.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.competencyScore.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.seasonScore.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.promotionRecommendation.deleteMany({
        where: { OR: [{ userId: { in: userIds } }, { decidedById: { in: userIds } }] },
      });
      await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    if (depotId) {
      await prisma.brigade.deleteMany({ where: { depotId } });
      await prisma.depot.delete({ where: { id: depotId } });
    }
    if (scenarioIds.length > 0) {
      await prisma.scenarioVersion.deleteMany({ where: { scenarioId: { in: scenarioIds } } });
      await prisma.scenario.deleteMany({ where: { id: { in: scenarioIds } } });
    }
  }
});

let scenarioForDecisions = '';

const GRAPH = {
  nodes: {
    n1: {
      choices: [
        { id: 'late', skills: { escalation: -1 } },
        { id: 'report', skills: { escalation: 2 } },
        { id: 'inspect', skills: { detection: 2 } },
        { id: 'skip', skills: { detection: -1 } },
      ],
    },
  },
};

function adapter(): FastifyAdapter {
  return new FastifyAdapter({ bodyLimit: 1_048_576 });
}

function call(method: string, url: string, user?: Actor, body?: unknown) {
  return appOf().inject({
    method: method as 'GET',
    url,
    headers: {
      ...(user ? { 'x-test-user': JSON.stringify(user) } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    payload: body === undefined ? undefined : JSON.stringify(body),
  });
}

let appRef: NestFastifyApplication | undefined;

function appOf(): NestFastifyApplication {
  if (!appRef) {
    throw new Error('приложение не поднято');
  }
  return appRef;
}

function score(
  userId: string,
  competency: 'escalation' | 'detection' | 'procedure' | 'service' | 'safety',
  value: number,
) {
  return { userId, competency, value };
}

function grant(
  userId: string,
  amount: number,
  reason: 'RUN' | 'ACHIEVEMENT' | 'CHALLENGE' | 'EXPIRE',
  expiresAt: Date | null,
  expiredAt: Date | null,
) {
  return { userId, amount, reason, expiresAt, expiredAt };
}

function outcomeFor(index: number): 'completed' | 'incident' | 'terminated' {
  if (index < 4) {
    return 'completed';
  }
  if (index === 4) {
    return 'incident';
  }
  return 'terminated';
}

function sessionData(userId: string, now: number) {
  return {
    userId,
    status: 'COMPLETED' as const,
    transport: 'REST' as const,
    plan: {},
    seedCommit: 'ab'.repeat(32),
    seedEnc: 'enc',
    state: {},
    expiresAt: new Date(now + 86_400_000),
  };
}

function decisionsFor(index: number) {
  if (index === 5) {
    return [decision(0, 'timeout', 'missed', 'enroute', false, null)];
  }
  const choiceId = index < 3 ? 'late' : 'report';
  const verdict = index < 3 ? 'worse' : 'best';
  const rows = [decision(0, choiceId, verdict, 'enroute', false, index === 0 ? 4000 : null)];
  if (index === 1) {
    rows[0] = decision(0, 'late', 'worse', 'enroute', false, 11_000);
  }
  if (index === 0 || index === 1) {
    rows.push(decision(rows.length, 'inspect', 'best', 'acceptance', false, null));
  }
  if (index === 0) {
    rows.push(decision(rows.length, 'skip', 'missed', 'acceptance', true, null));
  }
  return rows;
}

function decision(
  idx: number,
  choiceId: string,
  verdict: 'best' | 'ok' | 'worse' | 'missed',
  stage: 'acceptance' | 'enroute',
  lucky: boolean,
  reactionMs: number | null,
) {
  return {
    idx,
    gameTime: '09:34',
    stage,
    scenarioId: scenarioForDecisions,
    nodeId: 'n1',
    choiceId,
    situation: 'Ситуация',
    action: 'Действие',
    verdict,
    loyaltyDelta: verdict === 'worse' ? -4 : 2,
    safetyDelta: 6,
    reactionMs,
    lucky,
    consequence: lucky ? 'Обошлось' : null,
  };
}

type ProfileBody = {
  brigade: string;
  depot: string;
  grade: string;
  streakDays: number;
  level: number;
  levelFrom: number;
  levelTo: number;
  points: number;
  expiring: { points: number; at: string } | null;
  competencies: { escalation: number; reaction: number };
  trend: { detection: number };
  weakNote: { escalation?: string; detection?: string; safety?: string };
};

type ShiftBody = {
  train: string;
  from: string;
  to: string;
  departure: string;
  departureAt: string;
  focus: string[];
  stops: string[];
  carClass: string;
};

type RunBody = {
  playMinutes: number;
  carClass: string;
  facts: { prevented: number; incidents: number; complaints: number; interventions: number };
  decisions: {
    time: string;
    loyalty: number;
    reactionSec?: number;
  }[];
};

type CompareBody = {
  days: number;
  me: { brigadeRank: number | null; brigadeSize: number; loyalty: number | null };
  brigade: { competencies: { escalation: number }; safety: number | null } | null;
  depot: { competencies: { escalation: number }; safety: number | null } | null;
};

type GapsBody = {
  timeouts: number;
  decisions: number;
  timeoutShare: number;
  weak: { competency: string }[];
  recommendations: { scenarioId: string }[];
  hotspots: { scenarioId: string; nodeId: string; errors: number }[];
};
