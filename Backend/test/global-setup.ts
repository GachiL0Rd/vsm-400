import { spawn } from 'node:child_process';
import path from 'node:path';
import Redis from 'ioredis';
import { Client } from 'pg';
import {
  adminDatabaseUrl,
  assertDatabaseName,
  serviceUnavailable,
  TEST_DATABASE_NAMES,
  type TestDatabase,
  testDatabaseName,
  testDatabaseUrl,
  testRedisUrl,
} from './databases';

function pgCode(cause: unknown): string | undefined {
  if (typeof cause === 'object' && cause !== null && 'code' in cause) {
    const code = cause.code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

async function openPostgres(connectionString: string): Promise<Client> {
  const client = new Client({ connectionString, connectionTimeoutMillis: 3_000 });
  try {
    await client.connect();
  } catch (cause) {
    throw serviceUnavailable('Postgres', connectionString, cause);
  }
  return client;
}

async function ensureDatabase(client: Client, name: string): Promise<void> {
  const database = assertDatabaseName(name);
  const found = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
  if ((found.rowCount ?? 0) > 0) {
    return;
  }
  try {
    // Имя уже прошло assertDatabaseName: кавычки и пробелы внутрь не попадают.
    await client.query(`CREATE DATABASE "${database}"`);
  } catch (cause) {
    if (pgCode(cause) === '42P04') {
      return;
    }
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`Не удалось создать базу ${database}. Тесты не пропускаются. ${reason}`);
  }
}

function migrate(databaseUrl: string): Promise<void> {
  const prisma = path.join(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js');
  const database = new URL(databaseUrl).pathname.slice(1);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [prisma, 'migrate', 'deploy'], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: databaseUrl, PRISMA_HIDE_UPDATE_MESSAGE: '1' },
      stdio: 'inherit',
    });
    child.on('error', (cause) => {
      reject(serviceUnavailable('Postgres', databaseUrl, cause));
    });
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `prisma migrate deploy для ${database} завершился с кодом ${code ?? 'null'}. Тесты не пропускаются.`,
        ),
      );
    });
  });
}

async function assertRedis(): Promise<void> {
  const redisUrl = testRedisUrl('auth');
  const redis = new Redis(redisUrl, {
    connectTimeout: 3_000,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
    lazyConnect: true,
    enableOfflineQueue: false,
  });
  try {
    await redis.connect();
    const pong = await redis.ping();
    if (pong !== 'PONG') {
      throw new Error(`ответ ${pong}`);
    }
  } catch (cause) {
    throw serviceUnavailable('Redis', redisUrl, cause);
  } finally {
    redis.disconnect();
  }
}

/** Создаёт базы наборов и накатывает миграции. Без Postgres или Redis прогон падает. */
export default async function setup(): Promise<void> {
  await assertRedis();
  // Целевой базы может не быть. CREATE DATABASE выполняется из служебной postgres.
  const adminUrl = adminDatabaseUrl();
  const client = await openPostgres(adminUrl);
  try {
    for (const database of Object.keys(TEST_DATABASE_NAMES) as TestDatabase[]) {
      await ensureDatabase(client, testDatabaseName(database));
    }
  } finally {
    await client.end();
  }
  for (const database of Object.keys(TEST_DATABASE_NAMES) as TestDatabase[]) {
    await migrate(testDatabaseUrl(database));
  }
}
