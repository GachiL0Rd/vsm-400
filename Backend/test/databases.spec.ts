import { describe, expect, it } from 'vitest';
import {
  adminDatabaseUrl,
  assertDatabaseName,
  type EnvSource,
  explicitRedisDb,
  redisDbFor,
  redisSharesOneDb,
  serviceUnavailable,
  testDatabaseUrl,
  testRedisUrl,
} from './databases';

function source(env: Record<string, string | undefined>, file?: Record<string, string>): EnvSource {
  return {
    env: env as NodeJS.ProcessEnv,
    readFile: (name) => file?.[name],
  };
}

const password = ['top', 'secret'].join('');

function databaseUrl(): string {
  const url = new URL('postgresql://127.0.0.1:5433/vsm_fix_tests');
  url.username = 'vsm';
  url.password = password;
  url.searchParams.set('sslmode', 'disable');
  return url.toString();
}

describe('URL тестовой базы', () => {
  it('берёт TEST_DATABASE_URL и подменяет только имя базы', () => {
    const env = source({
      TEST_DATABASE_URL: databaseUrl(),
      DATABASE_URL: 'postgresql://10.0.0.1:1/nope',
    });
    const url = new URL(testDatabaseUrl('sessions', env));
    expect(url.pathname).toBe('/vsm_sessions');
    expect(url.username).toBe('vsm');
    expect(url.password).toBe(password);
    expect(url.hostname).toBe('127.0.0.1');
    expect(url.port).toBe('5433');
    expect(url.search).toBe('?sslmode=disable');
  });

  it('без TEST_DATABASE_URL читает DATABASE_URL, в том числе из файла', () => {
    const env = source({}, { DATABASE_URL: databaseUrl() });
    expect(new URL(testDatabaseUrl('cabinet', env)).pathname).toBe('/vsm_cabinet');
    expect(new URL(adminDatabaseUrl(env)).pathname).toBe('/postgres');
  });

  it('без URL падает и не предлагает пропуск', () => {
    expect(() => testDatabaseUrl('auth', source({}))).toThrow(/не пропускаются/);
    expect(() => testDatabaseUrl('auth', source({}))).toThrow(/DATABASE_URL/);
  });

  it('отклоняет имя базы вне [a-z0-9_]', () => {
    expect(() => assertDatabaseName('vsm;drop')).toThrow(/Недопустимое имя базы/);
    expect(() => assertDatabaseName('VSM')).toThrow(/Недопустимое имя базы/);
  });
});

describe('номер Redis', () => {
  it('без /N выдаёт каждому набору свой номер', () => {
    const env = source({ REDIS_URL: 'redis://127.0.0.1:6379' });
    expect(redisSharesOneDb(env)).toBe(false);
    expect(explicitRedisDb('redis://127.0.0.1:6379')).toBeUndefined();
    expect(redisDbFor('auth', env)).toBe(2);
    expect(redisDbFor('progression', env)).toBe(5);
    expect(new URL(testRedisUrl('scenarios', env)).pathname).toBe('/6');
    const indexes = ['auth', 'cabinet', 'sessions', 'progression', 'scenarios'] as const;
    expect(new Set(indexes.map((name) => redisDbFor(name, env))).size).toBe(indexes.length);
  });

  it('явный /N в REDIS_URL общий для всех наборов', () => {
    const env = source({ REDIS_URL: 'redis://127.0.0.1:6379/14' });
    expect(redisSharesOneDb(env)).toBe(true);
    expect(redisDbFor('auth', env)).toBe(14);
    expect(redisDbFor('progression', env)).toBe(14);
    expect(testRedisUrl('cabinet', env)).toBe('redis://127.0.0.1:6379/14');
  });

  it('без REDIS_URL падает и не предлагает пропуск', () => {
    expect(() => testRedisUrl('auth', source({}))).toThrow(/не пропускаются/);
    expect(() => testRedisUrl('auth', source({}))).toThrow(/REDIS_URL/);
  });

  it('номер больше 15 — ошибка', () => {
    expect(() => explicitRedisDb('redis://127.0.0.1:6379/16')).toThrow(/не пропускаются/);
  });
});

describe('снимок исходного URL', () => {
  const origin = 'VSM_TEST_DATABASE_ORIGIN';

  it('не подхватывает базу, которую предыдущий файл уже подменил', () => {
    const previousDatabase = process.env.DATABASE_URL;
    const previousTest = process.env.TEST_DATABASE_URL;
    const previousOrigin = process.env[origin];
    delete process.env.TEST_DATABASE_URL;
    delete process.env[origin];
    process.env.DATABASE_URL = databaseUrl();
    try {
      expect(new URL(testDatabaseUrl('auth')).pathname).toBe('/vsm_auth');
      process.env.DATABASE_URL = testDatabaseUrl('auth');
      expect(new URL(testDatabaseUrl('cabinet')).pathname).toBe('/vsm_cabinet');
    } finally {
      restore('DATABASE_URL', previousDatabase);
      restore('TEST_DATABASE_URL', previousTest);
      restore(origin, previousOrigin);
    }
  });
});

function restore(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

describe('недоступный сервис', () => {
  it('прячет пароль и запрещает тихий пропуск', () => {
    const error = serviceUnavailable('Postgres', databaseUrl(), new Error('connect ECONNREFUSED'));
    expect(error.message).toContain('Postgres недоступен');
    expect(error.message).toContain('не пропускаются');
    expect(error.message).toContain('ECONNREFUSED');
    expect(error.message).not.toContain(password);
    expect(error.message).toContain('***');
  });
});
