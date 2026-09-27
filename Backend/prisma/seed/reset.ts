import { PrismaPg } from '@prisma/adapter-pg';
import Redis from 'ioredis';
import { loadConfig } from '../../src/config/env';
import { PrismaClient } from '../../src/generated/prisma/client';

/**
 * Доменные таблицы, не _prisma_migrations.
 * Один TRUNCATE, чтобы внешние ключи не диктовали порядок.
 */
const TABLES = [
  'game_event',
  'run_decision',
  'point_ledger',
  'user_achievement',
  'season_score',
  'notification',
  'promotion_recommendation',
  'audit_log',
  'run',
  'game_session',
  'shift_assignment',
  'scenario_version',
  'scenario',
  'achievement',
  'auth_session',
  'webhook_delivery',
  'webhook_subscription',
  'api_client',
  'season',
  'competency_score',
  'user',
  'brigade',
  'depot',
] as const;

export async function resetDomain(): Promise<void> {
  const config = loadConfig();
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: config.databaseUrl }),
  });
  await prisma.$connect();
  const list = TABLES.map((name) => `"${name}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  await prisma.$disconnect();
  const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 2 });
  await redis.flushdb();
  await redis.quit();
  console.log('Доменные таблицы и текущая Redis DB очищены. Миграции не тронуты.');
}
