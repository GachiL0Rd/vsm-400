import type { DatabaseSync } from 'node:sqlite';
import { serveStatic } from '@hono/node-server/serve-static';
import { swaggerUI } from '@hono/swagger-ui';
import { createRoute, OpenAPIHono, type z } from '@hono/zod-openapi';
import { createMiddleware } from 'hono/factory';
import { createToken, hashToken, verifyPassword } from './auth.ts';
import {
  AchievementSchema,
  ConfigSchema,
  CredentialsSchema,
  ErrorSchema,
  HealthSchema,
  ProfileSchema,
  RunSchema,
  SessionSchema,
  StatsSchema,
} from './schemas.ts';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type AppOptions = {
  db: DatabaseSync;
  gameUrl: string;
  clientDir?: string;
  now?: () => number;
};

type AuthEnv = { Variables: { userId: number } };

function json<T extends z.ZodType>(schema: T, description: string) {
  return { description, content: { 'application/json': { schema } } };
}

const unauthorized = json(ErrorSchema, 'Нет токена, токен неизвестен или истёк');
const bearer = [{ Bearer: [] }];

export function createApp({ db, gameUrl, clientDir, now = Date.now }: AppOptions): OpenAPIHono {
  const app = new OpenAPIHono({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json({ error: 'invalid_request' }, 400);
      }
      return undefined;
    },
  });

  const requireAuth = createMiddleware<AuthEnv>(async (c, next) => {
    const header = c.req.header('Authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const session = token
      ? db
          .prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?')
          .get(hashToken(token))
      : undefined;
    if (session === undefined || Number(session.expires_at) <= now()) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    c.set('userId', Number(session.user_id));
    await next();
    return undefined;
  });

  app.openAPIRegistry.registerComponent('securitySchemes', 'Bearer', {
    type: 'http',
    scheme: 'bearer',
  });

  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/health',
      tags: ['Служебное'],
      summary: 'Проверка доступности',
      responses: { 200: json(HealthSchema, 'Сервер жив') },
    }),
    (c) => c.json({ ok: true }, 200),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/config',
      tags: ['Служебное'],
      summary: 'Настройки клиента',
      responses: { 200: json(ConfigSchema, 'Адрес игры') },
    }),
    (c) => c.json({ gameUrl }, 200),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/auth/login',
      tags: ['Авторизация'],
      summary: 'Вход по логину и паролю',
      request: {
        body: { required: true, content: { 'application/json': { schema: CredentialsSchema } } },
      },
      responses: {
        200: json(SessionSchema, 'Токен сессии на 7 дней'),
        400: json(ErrorSchema, 'Некорректное тело запроса'),
        401: json(ErrorSchema, 'Неверный логин или пароль'),
      },
    }),
    (c) => {
      const { login, password } = c.req.valid('json');
      const user = db.prepare('SELECT id, password_hash FROM users WHERE login = ?').get(login);
      if (user === undefined || !verifyPassword(password, String(user.password_hash))) {
        return c.json({ error: 'invalid_credentials' }, 401);
      }

      const token = createToken();
      const expiresAt = now() + SESSION_TTL_MS;
      db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now());
      db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(
        hashToken(token),
        Number(user.id),
        expiresAt,
      );
      return c.json({ token, expiresAt: new Date(expiresAt).toISOString() }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/auth/logout',
      tags: ['Авторизация'],
      summary: 'Отозвать текущий токен',
      security: bearer,
      middleware: [requireAuth] as const,
      responses: { 204: { description: 'Токен отозван' }, 401: unauthorized },
    }),
    (c) => {
      const token = (c.req.header('Authorization') ?? '').slice(7);
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/me',
      tags: ['Кабинет'],
      summary: 'Профиль текущего пользователя',
      security: bearer,
      middleware: [requireAuth] as const,
      responses: { 200: json(ProfileSchema, 'Профиль'), 401: unauthorized },
    }),
    (c) => {
      const row = db
        .prepare(
          `SELECT id, login, display_name AS displayName, position, created_at AS createdAt
           FROM users WHERE id = ?`,
        )
        .get(c.var.userId);
      return c.json(ProfileSchema.parse(row), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/me/achievements',
      tags: ['Кабинет'],
      summary: 'Все достижения с отметкой о получении',
      security: bearer,
      middleware: [requireAuth] as const,
      responses: {
        200: json(AchievementSchema.array(), 'Сначала полученные по дате, затем остальные'),
        401: unauthorized,
      },
    }),
    (c) => {
      const rows = db
        .prepare(
          `SELECT a.code, a.title, a.description, ua.earned_at AS earnedAt
           FROM achievements a
           LEFT JOIN user_achievements ua ON ua.achievement_code = a.code AND ua.user_id = ?
           ORDER BY ua.earned_at IS NULL, ua.earned_at, a.code`,
        )
        .all(c.var.userId);
      return c.json(AchievementSchema.array().parse(rows), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/me/runs',
      tags: ['Кабинет'],
      summary: 'История рейсов',
      security: bearer,
      middleware: [requireAuth] as const,
      responses: { 200: json(RunSchema.array(), 'Новые первыми'), 401: unauthorized },
    }),
    (c) => {
      const rows = db
        .prepare(
          `SELECT id, scenario_id AS scenarioId, finished_at AS finishedAt, outcome,
                  safety_score AS safetyScore, service_score AS serviceScore, errors
           FROM runs WHERE user_id = ? ORDER BY finished_at DESC`,
        )
        .all(c.var.userId);
      return c.json(RunSchema.array().parse(rows), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/me/stats',
      tags: ['Кабинет'],
      summary: 'Агрегированная статистика',
      security: bearer,
      middleware: [requireAuth] as const,
      responses: { 200: json(StatsSchema, 'Агрегаты по рейсам и достижениям'), 401: unauthorized },
    }),
    (c) => {
      const runs = db
        .prepare(
          `SELECT COUNT(*) AS runs,
                  COALESCE(SUM(outcome = 'completed'), 0) AS completedRuns,
                  ROUND(AVG(safety_score)) AS avgSafetyScore,
                  ROUND(AVG(service_score)) AS avgServiceScore,
                  COALESCE(SUM(errors), 0) AS errors
           FROM runs WHERE user_id = ?`,
        )
        .get(c.var.userId);
      const achievements = db
        .prepare(
          `SELECT (SELECT COUNT(*) FROM user_achievements WHERE user_id = ?) AS achievementsEarned,
                  (SELECT COUNT(*) FROM achievements) AS achievementsTotal`,
        )
        .get(c.var.userId);
      return c.json(StatsSchema.parse({ ...runs, ...achievements }), 200);
    },
  );

  app.doc31('/api/openapi.json', {
    openapi: '3.1.0',
    info: { title: 'VSM Cabinet API', version: '0.1.0' },
  });
  app.get('/api/docs', swaggerUI({ url: '/api/openapi.json' }));

  app.all('/api/*', (c) => c.json({ error: 'not_found' }, 404));

  if (clientDir !== undefined) {
    app.use('/*', serveStatic({ root: clientDir }));
  }

  return app;
}
