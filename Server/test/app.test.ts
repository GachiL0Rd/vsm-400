import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { createApp } from '../src/app.ts';
import { openDatabase, seedDemoData } from '../src/db.ts';

let clock = Date.parse('2026-09-25T12:00:00.000Z');
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  clock = Date.parse('2026-09-25T12:00:00.000Z');
  const db = openDatabase(':memory:');
  seedDemoData(db);
  app = createApp({ db, gameUrl: 'http://game.test/', now: () => clock });
});

async function login(loginName: string, password: string): Promise<Response> {
  return app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: loginName, password }),
  });
}

async function tokenFor(loginName: string): Promise<string> {
  const res = await login(loginName, loginName);
  const body = (await res.json()) as { token: string };
  return body.token;
}

function authed(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  return Promise.resolve(
    app.request(path, { ...init, headers: { Authorization: `Bearer ${token}` } }),
  );
}

describe('auth', () => {
  test('выдаёт токен при верном пароле', async () => {
    const res = await login('demo', 'demo');
    assert.equal(res.status, 200);
    const body = (await res.json()) as { token: string; expiresAt: string };
    assert.ok(body.token.length > 20);
    assert.equal(body.expiresAt, '2026-10-02T12:00:00.000Z');
  });

  test('отклоняет неверный пароль и неизвестного пользователя', async () => {
    assert.equal((await login('demo', 'wrong')).status, 401);
    assert.equal((await login('ghost', 'demo')).status, 401);
  });

  test('отклоняет некорректное тело', async () => {
    const post = (body: string, headers: Record<string, string> = {}) =>
      app.request('/api/auth/login', { method: 'POST', headers, body });
    const asJson = { 'Content-Type': 'application/json' };

    assert.equal((await post('not json')).status, 415);
    assert.equal((await post('not json', asJson)).status, 400);
    const empty = await post(JSON.stringify({ login: '  ', password: 'x' }), asJson);
    assert.equal(empty.status, 400);
    assert.deepEqual(await empty.json(), { error: 'invalid_request' });
  });

  test('закрытые маршруты требуют токен', async () => {
    assert.equal((await app.request('/api/me')).status, 401);
    assert.equal((await authed('/api/me', 'bogus')).status, 401);
  });

  test('сессия истекает', async () => {
    const token = await tokenFor('demo');
    clock += 8 * 24 * 60 * 60 * 1000;
    assert.equal((await authed('/api/me', token)).status, 401);
  });

  test('logout отзывает токен', async () => {
    const token = await tokenFor('demo');
    assert.equal((await authed('/api/auth/logout', token, { method: 'POST' })).status, 204);
    assert.equal((await authed('/api/me', token)).status, 401);
  });
});

describe('кабинет', () => {
  test('профиль без хеша пароля', async () => {
    const res = await authed('/api/me', await tokenFor('demo'));
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.login, 'demo');
    assert.equal(body.displayName, 'Анна Смирнова');
    assert.equal('password_hash' in body, false);
  });

  test('достижения: полученные первыми, остальные с earnedAt = null', async () => {
    const res = await authed('/api/me/achievements', await tokenFor('demo'));
    const list = (await res.json()) as { code: string; earnedAt: string | null }[];
    assert.equal(list.length, 5);
    assert.deepEqual(
      list.slice(0, 2).map((a) => a.code),
      ['early-find', 'clean-run'],
    );
    assert.equal(
      list.slice(2).every((a) => a.earnedAt === null),
      true,
    );
  });

  test('рейсы и статистика принадлежат текущему пользователю', async () => {
    const demo = await tokenFor('demo');
    const novice = await tokenFor('novice');

    const runs = (await (await authed('/api/me/runs', demo)).json()) as unknown[];
    assert.equal(runs.length, 3);
    assert.deepEqual(await (await authed('/api/me/runs', novice)).json(), []);

    assert.deepEqual(await (await authed('/api/me/stats', demo)).json(), {
      runs: 3,
      completedRuns: 2,
      avgSafetyScore: 74,
      avgServiceScore: 80,
      errors: 5,
      achievementsEarned: 2,
      achievementsTotal: 5,
    });
    assert.deepEqual(await (await authed('/api/me/stats', novice)).json(), {
      runs: 0,
      completedRuns: 0,
      avgSafetyScore: null,
      avgServiceScore: null,
      errors: 0,
      achievementsEarned: 0,
      achievementsTotal: 5,
    });
  });

  test('неизвестный API-маршрут — 404', async () => {
    assert.equal((await app.request('/api/nope')).status, 404);
  });

  test('OpenAPI-документ описывает все маршруты, Swagger UI доступен', async () => {
    const doc = (await (await app.request('/api/openapi.json')).json()) as {
      paths: Record<string, unknown>;
    };
    assert.deepEqual(Object.keys(doc.paths).sort(), [
      '/api/auth/login',
      '/api/auth/logout',
      '/api/config',
      '/api/health',
      '/api/me',
      '/api/me/achievements',
      '/api/me/runs',
      '/api/me/stats',
    ]);
    const ui = await app.request('/api/docs');
    assert.equal(ui.status, 200);
    assert.match(await ui.text(), /swagger/i);
  });

  test('конфиг отдаёт адрес игры', async () => {
    assert.deepEqual(await (await app.request('/api/config')).json(), {
      gameUrl: 'http://game.test/',
    });
  });
});
