import { existsSync, readFileSync } from 'node:fs';

/**
 * Базы интеграционных наборов. `vsm` сюда не входит: там демо-сид.
 * globalSetup создаёт отсутствующие и накатывает migrate deploy.
 */
export const TEST_DATABASE_NAMES = {
  auth: 'vsm_auth',
  cabinet: 'vsm_cabinet',
  sessions: 'vsm_sessions',
  scenarios: 'vsm_scenarios',
  progression: 'vsm_progression',
  llm: 'vsm_llm_core',
} as const;

export type TestDatabase = keyof typeof TEST_DATABASE_NAMES;

/**
 * Номер Redis, если в REDIS_URL путь без /N.
 * Явный /N — слот worktree (локально 14): все наборы остаются на нём,
 * чтобы не занять DB соседних агентов. Тогда файлы гоняются по очереди.
 */
export const TEST_REDIS_DB: Record<TestDatabase, number> = {
  auth: 2,
  cabinet: 3,
  sessions: 4,
  progression: 5,
  scenarios: 6,
  llm: 15,
};

const DB_NAME = /^[a-z_][a-z0-9_]*$/;

// Воркер Vitest переживает файл и сохраняет process.env. Снимок исходного URL
// не даёт следующему набору принять уже подменённую базу соседа за основу.
const ORIGIN_DATABASE = 'VSM_TEST_DATABASE_ORIGIN';
const ORIGIN_REDIS = 'VSM_TEST_REDIS_ORIGIN';

export type EnvSource = {
  env?: NodeJS.ProcessEnv;
  readFile?: (name: string) => string | undefined;
};

export function assertDatabaseName(name: string): string {
  if (!DB_NAME.test(name)) {
    throw new Error(`Недопустимое имя базы: ${name}`);
  }
  return name;
}

function envOf(source?: EnvSource): NodeJS.ProcessEnv {
  return source?.env ?? process.env;
}

function readDotEnvValue(name: string): string | undefined {
  if (!existsSync('.env')) {
    return undefined;
  }
  const text = readFileSync('.env', 'utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) {
      continue;
    }
    if (trimmed.startsWith(`${name}=`)) {
      return trimmed.slice(name.length + 1).trim();
    }
  }
  return undefined;
}

function readValue(name: string, source?: EnvSource): string | undefined {
  const fromEnv = envOf(source)[name];
  if (typeof fromEnv === 'string' && fromEnv.length > 0) {
    return fromEnv;
  }
  const readFile = source?.readFile ?? readDotEnvValue;
  const fromFile = readFile(name);
  if (typeof fromFile === 'string' && fromFile.length > 0) {
    return fromFile;
  }
  return undefined;
}

function missingDatabaseUrl(): Error {
  return new Error(
    'Postgres: нет DATABASE_URL и TEST_DATABASE_URL. Задайте строку в окружении или Backend/.env. Тесты с базой не пропускаются.',
  );
}

function missingRedisUrl(): Error {
  return new Error(
    'Redis: нет REDIS_URL. Задайте строку в окружении или Backend/.env. Тесты с Redis не пропускаются.',
  );
}

function remember(key: string, value: string): string {
  process.env[key] = value;
  return value;
}

/** TEST_DATABASE_URL важнее DATABASE_URL: тесты можно направить мимо URL приложения. */
export function resolveDatabaseUrl(source?: EnvSource): string {
  if (source) {
    const url = readValue('TEST_DATABASE_URL', source) ?? readValue('DATABASE_URL', source);
    if (!url) {
      throw missingDatabaseUrl();
    }
    return url;
  }
  const saved = process.env[ORIGIN_DATABASE];
  if (saved) {
    return saved;
  }
  const url = readValue('TEST_DATABASE_URL') ?? readValue('DATABASE_URL');
  if (!url) {
    throw missingDatabaseUrl();
  }
  return remember(ORIGIN_DATABASE, url);
}

export function resolveRedisUrl(source?: EnvSource): string {
  if (source) {
    const url = readValue('REDIS_URL', source);
    if (!url) {
      throw missingRedisUrl();
    }
    return url;
  }
  const saved = process.env[ORIGIN_REDIS];
  if (saved) {
    return saved;
  }
  const url = readValue('REDIS_URL');
  if (!url) {
    throw missingRedisUrl();
  }
  return remember(ORIGIN_REDIS, url);
}

export function replaceDatabase(baseUrl: string, database: string): string {
  const name = assertDatabaseName(database);
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch (cause) {
    throw serviceUnavailable('Postgres', baseUrl, cause);
  }
  url.pathname = `/${name}`;
  return url.toString();
}

/**
 * От основной базы `vsm` — общие имена наборов, как в CI.
 * От другой (worktree, второй прогон) — её имя префиксом: параллельные
 * прогоны на одном Postgres не чистят и не мигрируют базы друг друга.
 */
export function testDatabaseName(database: TestDatabase, source?: EnvSource): string {
  const shared = TEST_DATABASE_NAMES[database];
  const base = baseDatabaseName(resolveDatabaseUrl(source));
  if (base === null || base === 'vsm') {
    return shared;
  }
  return assertDatabaseName(`${base}_${shared.slice('vsm_'.length)}`);
}

export function testDatabaseUrl(database: TestDatabase, source?: EnvSource): string {
  return replaceDatabase(resolveDatabaseUrl(source), testDatabaseName(database, source));
}

function baseDatabaseName(baseUrl: string): string | null {
  try {
    const name = decodeURIComponent(new URL(baseUrl).pathname.slice(1));
    return name.length > 0 ? name : null;
  } catch {
    return null;
  }
}

/** Служебная база, чтобы CREATE DATABASE работал, когда целевой ещё нет. */
export function adminDatabaseUrl(source?: EnvSource): string {
  return replaceDatabase(resolveDatabaseUrl(source), 'postgres');
}

/** Номер в пути redis://host:port/N. Пустой путь — номер не зафиксирован. */
export function explicitRedisDb(redisUrl: string): number | undefined {
  let pathname = '';
  try {
    pathname = new URL(redisUrl).pathname;
  } catch (cause) {
    throw serviceUnavailable('Redis', redisUrl, cause);
  }
  const match = /^\/(\d+)$/.exec(pathname);
  if (!match?.[1]) {
    return undefined;
  }
  const index = Number(match[1]);
  if (!Number.isInteger(index) || index > 15) {
    throw new Error(
      `Redis: номер DB ${index} вне 0..15 (${redactUrl(redisUrl)}). Тесты не пропускаются.`,
    );
  }
  return index;
}

export function redisDbFor(database: TestDatabase, source?: EnvSource): number {
  const pinned = explicitRedisDb(resolveRedisUrl(source));
  if (pinned !== undefined) {
    return pinned;
  }
  return TEST_REDIS_DB[database];
}

export function testRedisUrl(database: TestDatabase, source?: EnvSource): string {
  const base = resolveRedisUrl(source);
  const url = new URL(base);
  url.pathname = `/${redisDbFor(database, source)}`;
  return url.toString();
}

/** true: один номер на все наборы, FLUSHDB пересечётся при параллельных файлах. */
export function redisSharesOneDb(source?: EnvSource): boolean {
  const url = readValue('REDIS_URL', source);
  if (!url) {
    return false;
  }
  return explicitRedisDb(url) !== undefined;
}

export function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.password) {
      url.password = '***';
    }
    return url.toString();
  } catch {
    return '(не URL)';
  }
}

export function serviceUnavailable(
  service: 'Postgres' | 'Redis',
  target: string,
  cause: unknown,
): Error {
  const reason = cause instanceof Error ? cause.message : String(cause);
  const variable = service === 'Postgres' ? 'DATABASE_URL' : 'REDIS_URL';
  return new Error(
    `${service} недоступен (${redactUrl(target)}). Проверьте ${variable} и что сервис запущен. Тесты не пропускаются. ${reason}`,
  );
}
