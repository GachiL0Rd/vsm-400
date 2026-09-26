import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module';
import { AuditService } from '../src/audit/audit.service';
import { BootstrapService } from '../src/auth/bootstrap.service';
import { PasswordService } from '../src/auth/password.service';
import { APP_CONFIG, type AppConfig } from '../src/config/env';
import { configureApp } from '../src/configure-app';
import { Grade, Role } from '../src/generated/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';
import { redisDbFor, testDatabaseUrl, testRedisUrl } from './databases';

type CookieBag = Map<string, { value: string; attrs: Record<string, string | true> }>;

type Injected = {
  statusCode: number;
  body: string;
  headers: Record<string, string | string[] | undefined>;
  json: () => unknown;
};

function http(app: NestFastifyApplication) {
  return app.getHttpAdapter().getInstance();
}

function setCookies(response: Injected): CookieBag {
  const raw = response.headers['set-cookie'];
  const lines = !raw ? [] : Array.isArray(raw) ? raw : [raw];
  const bag: CookieBag = new Map();
  for (const line of lines) {
    const parts = line.split(';').map((part) => part.trim());
    const pair = parts[0] ?? '';
    const eq = pair.indexOf('=');
    const name = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    const attrs: Record<string, string | true> = {};
    for (const part of parts.slice(1)) {
      const index = part.indexOf('=');
      if (index === -1) {
        attrs[part.toLowerCase()] = true;
      } else {
        attrs[part.slice(0, index).toLowerCase()] = part.slice(index + 1);
      }
    }
    bag.set(name, { value, attrs });
  }
  return bag;
}

function cookieHeader(bag: CookieBag): string {
  return [...bag.entries()].map(([name, cookie]) => `${name}=${cookie.value}`).join('; ');
}

function problem(response: Injected): { code: string; detail: string; status: number } {
  return response.json() as { code: string; detail: string; status: number };
}

describe('auth e2e', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  let passwords: PasswordService;

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl('auth');
    process.env.REDIS_URL = testRedisUrl('auth');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const adapter = new FastifyAdapter({ bodyLimit: 1_048_576 });
    app = moduleRef.createNestApplication(adapter, { logger: false });
    await configureApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    const config = app.get<AppConfig>(APP_CONFIG);
    expect(config.databaseUrl).toContain('/vsm_auth');
    expect(config.redisUrl.endsWith(`/${redisDbFor('auth')}`)).toBe(true);
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    passwords = app.get(PasswordService);
  }, 30_000);

  beforeEach(async () => {
    await prisma.authSession.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.user.deleteMany();
    await prisma.brigade.deleteMany();
    await prisma.depot.deleteMany();
    await redis.flushdb();
  });

  afterAll(async () => {
    await app.close();
  });

  async function makeUser(input: {
    login: string;
    role: Role;
    callsign: string;
    password?: string;
    mustChangePassword?: boolean;
    brigadeId?: string | null;
    grade?: Grade;
    position?: string;
  }) {
    const password = input.password ?? 'temporary-pass-1';
    const user = await prisma.user.create({
      data: {
        login: input.login,
        role: input.role,
        callsign: input.callsign,
        passwordHash: await passwords.hash(password),
        position: input.position ?? 'Проводник',
        grade: input.grade ?? Grade.TRAINEE,
        mustChangePassword: input.mustChangePassword ?? false,
        brigadeId: input.brigadeId ?? null,
      },
    });
    return { user, password };
  }

  async function inject(
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    extra?: { payload?: Record<string, unknown>; cookie?: string; authorization?: string },
  ): Promise<Injected> {
    const headers: Record<string, string> = {};
    if (extra?.cookie) {
      headers.cookie = extra.cookie;
    }
    if (extra?.authorization) {
      headers.authorization = extra.authorization;
    }
    const sent = await http(app).inject({
      method,
      url,
      payload: extra?.payload,
      headers,
    });
    return sent as unknown as Injected;
  }

  async function login(loginName: string, password: string) {
    const response = await inject('POST', '/api/v1/auth/login', {
      payload: { login: loginName, password },
    });
    return { response, cookies: setCookies(response) };
  }

  it('неверный логин и пароль отвечают одинаково', async () => {
    await makeUser({ login: 'known', role: Role.CONDUCTOR, callsign: 'KNWN' });
    const unknown = await login('missing-user', 'wrong-password-1');
    const wrong = await login('known', 'wrong-password-1');
    expect(unknown.response.statusCode).toBe(401);
    expect(problem(unknown.response)).toEqual(problem(wrong.response));
    expect(problem(unknown.response).code).toBe('INVALID_CREDENTIALS');
  });

  it('вход ставит cookies и кладёт claims в JWT', async () => {
    const { user, password } = await makeUser({
      login: 'conductor',
      role: Role.CONDUCTOR,
      callsign: 'CND1',
    });
    const { response, cookies } = await login('conductor', password);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      user: {
        id: user.id,
        login: 'conductor',
        callsign: 'CND1',
        role: Role.CONDUCTOR,
        grade: Grade.TRAINEE,
        mustChangePassword: false,
      },
    });
    const access = cookies.get('vsm_access');
    const refresh = cookies.get('vsm_refresh');
    expect(access?.attrs.httponly).toBe(true);
    expect(access?.attrs.samesite).toBe('Lax');
    expect(access?.attrs.path).toBe('/');
    expect(access?.attrs['max-age']).toBe('900');
    expect(access?.attrs.secure).toBeUndefined();
    expect(refresh?.attrs.httponly).toBe(true);
    expect(refresh?.attrs.samesite).toBe('Strict');
    expect(refresh?.attrs.path).toBe('/api/v1/auth');
    expect(refresh?.attrs['max-age']).toBe(String(7 * 24 * 60 * 60));
    const payload = JSON.parse(
      Buffer.from((access?.value.split('.')[1] ?? '').toString(), 'base64url').toString(),
    ) as {
      sub: string;
      role: string;
      bid: string | null;
      did: string | null;
      sid: string;
      exp: number;
      iat: number;
    };
    expect(payload).toMatchObject({ sub: user.id, role: Role.CONDUCTOR, bid: null, did: null });
    expect(payload.exp - payload.iat).toBe(900);
    const stored = await prisma.authSession.findFirstOrThrow({ where: { userId: user.id } });
    expect(payload.sid).toBe(stored.id);
    expect(stored.refreshHash).toHaveLength(64);
    expect(stored.refreshHash).not.toBe(refresh?.value);

    const byBearer = await inject('GET', '/api/v1/auth/session', {
      authorization: `Bearer ${access?.value ?? ''}`,
    });
    expect(byBearer.statusCode).toBe(200);
    expect(byBearer.json()).toEqual({
      id: user.id,
      role: Role.CONDUCTOR,
      brigadeId: null,
      depotId: null,
    });
  });

  it('refresh вращает токен, повтор старого отзывает все сессии', async () => {
    const { password } = await makeUser({
      login: 'rotator',
      role: Role.CONDUCTOR,
      callsign: 'ROT1',
    });
    const first = await login('rotator', password);
    const rotated = await inject('POST', '/api/v1/auth/refresh', {
      cookie: cookieHeader(first.cookies),
    });
    expect(rotated.statusCode).toBe(200);
    const rotatedCookies = setCookies(rotated);
    const stale = await inject('GET', '/api/v1/auth/session', {
      authorization: `Bearer ${first.cookies.get('vsm_access')?.value ?? ''}`,
    });
    expect(stale.statusCode).toBe(401);
    expect(problem(stale).code).toBe('SESSION_REVOKED');
    const fresh = await inject('GET', '/api/v1/auth/session', {
      authorization: `Bearer ${rotatedCookies.get('vsm_access')?.value ?? ''}`,
    });
    expect(fresh.statusCode).toBe(200);
    expect(rotatedCookies.get('vsm_refresh')?.value).not.toBe(
      first.cookies.get('vsm_refresh')?.value,
    );
    const again = await inject('POST', '/api/v1/auth/refresh', {
      cookie: cookieHeader(rotatedCookies),
    });
    expect(again.statusCode).toBe(200);
    const reuse = await inject('POST', '/api/v1/auth/refresh', {
      cookie: `vsm_refresh=${first.cookies.get('vsm_refresh')?.value ?? ''}`,
    });
    expect(reuse.statusCode).toBe(401);
    expect(problem(reuse).code).toBe('REFRESH_REUSE');
    const newest = setCookies(again).get('vsm_refresh')?.value ?? '';
    const afterReuse = await inject('POST', '/api/v1/auth/refresh', {
      cookie: `vsm_refresh=${newest}`,
    });
    expect(afterReuse.statusCode).toBe(401);
    const live = await prisma.authSession.count({ where: { revokedAt: null } });
    expect(live).toBe(0);
    const audit = await prisma.auditLog.findFirst({ where: { action: 'auth.refresh.reuse' } });
    expect(audit?.actorType).toBe('USER');
  });

  it('logout отзывает refresh и чистит cookies', async () => {
    const { password } = await makeUser({
      login: 'leaver',
      role: Role.CONDUCTOR,
      callsign: 'LEA1',
    });
    const session = await login('leaver', password);
    const out = await inject('POST', '/api/v1/auth/logout', {
      cookie: cookieHeader(session.cookies),
    });
    expect(out.statusCode).toBe(200);
    const cleared = setCookies(out);
    expect(cleared.get('vsm_access')?.attrs['max-age']).toBe('0');
    expect(cleared.get('vsm_refresh')?.attrs.path).toBe('/api/v1/auth');
    const refresh = await inject('POST', '/api/v1/auth/refresh', {
      cookie: `vsm_refresh=${session.cookies.get('vsm_refresh')?.value ?? ''}`,
    });
    expect(refresh.statusCode).toBe(401);
    const access = await inject('GET', '/api/v1/auth/session', {
      cookie: `vsm_access=${session.cookies.get('vsm_access')?.value ?? ''}`,
    });
    expect(access.statusCode).toBe(401);
    expect(problem(access).code).toBe('SESSION_REVOKED');
  });

  it('без токена 401, чужая роль 403, публичный логин и health живы', async () => {
    const missing = await inject('GET', '/api/v1/auth/session');
    expect(missing.statusCode).toBe(401);
    expect(problem(missing).code).toBe('UNAUTHENTICATED');

    const health = await inject('GET', '/api/health');
    expect(health.statusCode).toBe(200);

    const anon = await login('nobody', 'wrong-password-1');
    expect(anon.response.statusCode).toBe(401);
    expect(problem(anon.response).code).toBe('INVALID_CREDENTIALS');
    const failure = await prisma.auditLog.findFirst({ where: { action: 'auth.login.failure' } });
    expect(failure?.target).toBeNull();
    expect(failure?.actorId).toBeNull();
    expect(failure?.ip).toBeTruthy();

    const { password } = await makeUser({
      login: 'conductor-role',
      role: Role.CONDUCTOR,
      callsign: 'ROL1',
    });
    const session = await login('conductor-role', password);
    const denied = await inject('GET', '/api/v1/admin/users', {
      cookie: cookieHeader(session.cookies),
    });
    expect(denied.statusCode).toBe(403);
    expect(problem(denied).code).toBe('FORBIDDEN');
  });

  it('mustChangePassword пускает смену пароля и сессию, кабинет закрыт', async () => {
    const { password } = await makeUser({
      login: 'newbie',
      role: Role.CONDUCTOR,
      callsign: 'NEW1',
      mustChangePassword: true,
    });
    const session = await login('newbie', password);
    const cookie = cookieHeader(session.cookies);
    const blocked = await inject('GET', '/api/v1/org/depots', { cookie });
    expect(blocked.statusCode).toBe(403);
    expect(problem(blocked).code).toBe('PASSWORD_CHANGE_REQUIRED');
    const allowed = await inject('GET', '/api/v1/auth/session', { cookie });
    expect(allowed.statusCode).toBe(200);
    const cabinet = await inject('GET', '/api/v1/me', { cookie });
    expect(cabinet.statusCode).toBe(403);
    expect(problem(cabinet).code).toBe('PASSWORD_CHANGE_REQUIRED');
    const refreshed = await inject('POST', '/api/v1/auth/refresh', { cookie });
    expect(refreshed.statusCode).toBe(403);
    expect(problem(refreshed).code).toBe('PASSWORD_CHANGE_REQUIRED');
    const still = await inject('GET', '/api/v1/auth/session', { cookie });
    expect(still.statusCode).toBe(200);
    const weak = await inject('POST', '/api/v1/auth/password', {
      cookie,
      payload: { current: password, next: 'short' },
    });
    expect(weak.statusCode).toBe(422);
    expect(problem(weak).code).toBe('VALIDATION');
    const changed = await inject('POST', '/api/v1/auth/password', {
      cookie,
      payload: { current: password, next: 'long-enough-1' },
    });
    expect(changed.statusCode).toBe(200);
    expect(
      (changed.json() as { user: { mustChangePassword: boolean } }).user.mustChangePassword,
    ).toBe(false);
    const opened = await inject('GET', '/api/v1/org/depots', {
      cookie: cookieHeader(setCookies(changed)),
    });
    expect(opened.statusCode).toBe(200);
    expect(opened.json()).toEqual([]);
  });

  it('bootstrap создаёт единственного admin', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const created = await app.get(BootstrapService).ensureAdmin();
    const again = await app.get(BootstrapService).ensureAdmin();
    expect(created?.login).toBe('admin');
    expect(created?.password.length).toBeGreaterThanOrEqual(10);
    expect(again).toBeNull();
    expect(await prisma.user.count({ where: { role: Role.ADMIN } })).toBe(1);
    const admin = await prisma.user.findUniqueOrThrow({ where: { login: 'admin' } });
    expect(admin.mustChangePassword).toBe(true);
    expect(admin.callsign).toMatch(/^[A-Z0-9]{4}$/);
    expect(log.mock.calls.flat().join('\n')).toContain(created?.password ?? '');
    log.mockRestore();
  });

  it('админ получает уникальные позывные, чужая бригада закрыта', async () => {
    const depot = await prisma.depot.create({
      data: { code: 'OCT', name: 'Depot', city: 'Moscow' },
    });
    const own = await prisma.brigade.create({
      data: { code: '12', name: 'Бригада 12', depotId: depot.id },
    });
    const other = await prisma.brigade.create({
      data: { code: '13', name: 'Бригада 13', depotId: depot.id },
    });
    const admin = await makeUser({
      login: 'root',
      role: Role.ADMIN,
      callsign: 'ROOT',
      grade: Grade.INSTRUCTOR,
      position: 'Администратор',
    });
    const chief = await makeUser({
      login: 'chief',
      role: Role.CHIEF,
      callsign: 'CHF1',
      brigadeId: own.id,
      grade: Grade.INSTRUCTOR,
      position: 'Начальник поезда',
    });
    await makeUser({
      login: 'member',
      role: Role.CONDUCTOR,
      callsign: 'MEM1',
      brigadeId: own.id,
    });
    const adminSession = await login(admin.user.login, admin.password);
    const createdA = await inject('POST', '/api/v1/admin/users', {
      cookie: cookieHeader(adminSession.cookies),
      payload: {
        login: 'fresh-a',
        role: Role.CONDUCTOR,
        position: 'Проводник',
        grade: Grade.TRAINEE,
        brigadeId: own.id,
      },
    });
    const createdB = await inject('POST', '/api/v1/admin/users', {
      cookie: cookieHeader(adminSession.cookies),
      payload: {
        login: 'fresh-b',
        role: Role.CONDUCTOR,
        position: 'Проводник',
        grade: Grade.TRAINEE,
      },
    });
    expect(createdA.statusCode).toBe(201);
    expect(createdB.statusCode).toBe(201);
    const bodyA = createdA.json() as {
      password: string;
      user: { callsign: string; mustChangePassword: boolean };
    };
    const bodyB = createdB.json() as { user: { callsign: string } };
    expect(bodyA.password.length).toBeGreaterThanOrEqual(10);
    expect(bodyA.user.callsign).toMatch(/^[A-Z0-9]{4}$/);
    expect(bodyB.user.callsign).toMatch(/^[A-Z0-9]{4}$/);
    expect(bodyA.user.callsign).not.toBe(bodyB.user.callsign);
    expect(bodyA.user.mustChangePassword).toBe(true);
    expect(bodyA.user).not.toHaveProperty('passwordHash');

    const chiefSession = await login(chief.user.login, chief.password);
    const ownBrigade = await inject('GET', `/api/v1/org/brigades/${own.id}`, {
      cookie: cookieHeader(chiefSession.cookies),
    });
    expect(ownBrigade.statusCode).toBe(200);
    const members = (ownBrigade.json() as { members: Array<Record<string, string>> }).members;
    expect(members.some((member) => member.callsign === 'MEM1')).toBe(true);
    expect(members.every((member) => !('login' in member))).toBe(true);
    const foreign = await inject('GET', `/api/v1/org/brigades/${other.id}`, {
      cookie: cookieHeader(chiefSession.cookies),
    });
    expect(foreign.statusCode).toBe(403);
    expect(problem(foreign).code).toBe('BRIGADE_FORBIDDEN');
    const asAdmin = await inject('GET', `/api/v1/org/brigades/${own.id}`, {
      cookie: cookieHeader(adminSession.cookies),
    });
    const adminMembers = (asAdmin.json() as { members: Array<Record<string, string>> }).members;
    expect(adminMembers.find((member) => member.callsign === 'MEM1')?.login).toBe('member');

    const query = new URLSearchParams({ role: Role.CONDUCTOR, brigade: own.id });
    const listed = await inject('GET', `/api/v1/admin/users?${query}`, {
      cookie: cookieHeader(adminSession.cookies),
    });
    expect(listed.statusCode).toBe(200);
    const items = (listed.json() as { items: Array<{ login: string }> }).items;
    expect(items.some((item) => item.login === 'fresh-a')).toBe(true);
    expect(items.some((item) => item.login === 'fresh-b')).toBe(false);

    const audits = await app.get(AuditService).list(1, 20);
    expect(audits.items.some((item) => item.action === 'user.created')).toBe(true);
    const auditHttp = await inject('GET', '/api/v1/admin/audit', {
      cookie: cookieHeader(adminSession.cookies),
    });
    expect(auditHttp.statusCode).toBe(200);
  });

  it('шестая попытка логина с того же IP и логина — 429', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await login('throttle-user', 'wrong-password-1');
      expect(response.response.statusCode).toBe(401);
    }
    const blocked = await login('throttle-user', 'wrong-password-1');
    expect(blocked.response.statusCode).toBe(429);
    const other = await login('throttle-other', 'wrong-password-1');
    expect(other.response.statusCode).toBe(401);
  }, 30_000);
});
