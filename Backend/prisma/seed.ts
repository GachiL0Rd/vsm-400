import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AppModule } from '../src/app.module';
import { PasswordService } from '../src/auth/password.service';
import { APP_CONFIG, type AppConfig } from '../src/config/env';
import { SeasonsService } from '../src/leaderboard/seasons.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';
import { RulesService } from '../src/rules/rules.service';
import { UsersService } from '../src/users/users.service';
import { alignLedger } from './seed/align-ledger';
import { catalogOf, loadAchievementEntries, loadGraphs, loadRoutes } from './seed/content';
import { finishDemo } from './seed/demo-finish';
import { seedHistory } from './seed/history';
import { seedOrg } from './seed/org';
import { resetDomain } from './seed/reset';
import { rebuildCurrentSeason } from './seed/season';
import { printSummary } from './seed/summary';

/**
 * Повтор без --reset ничего не пишет, если уже есть логин demo.
 * --reset очищает домен и Redis DB из REDIS_URL, миграции не трогает.
 * Админа сид не создаёт: это BootstrapService, если ADMIN ещё нет.
 */
async function main(): Promise<void> {
  const reset = process.argv.includes('--reset');
  if (reset) {
    await resetDomain();
  }
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const prisma = app.get(PrismaService);
    const rules = app.get(RulesService);
    const marker = await prisma.user.findUnique({
      where: { login: 'demo' },
      select: { id: true },
    });
    if (marker && !reset) {
      console.log('Маркер demo уже есть. Повтор без --reset ничего не пишет.');
      await printSummary(prisma, rules);
      return;
    }
    const versions = await publishedVersions(prisma);
    const graphs = loadGraphs();
    const ctx = {
      catalog: catalogOf(graphs, versions),
      graphs,
      routes: loadRoutes(),
      scoring: rules.scoring(),
      achievements: loadAchievementEntries(),
    };
    const now = new Date();
    const staff = await seedOrg({
      prisma,
      users: app.get(UsersService),
      passwords: app.get(PasswordService),
    });
    const config = app.get<AppConfig>(APP_CONFIG);
    await seedHistory(
      {
        prisma,
        events: app.get(EventEmitter2),
        seedKey: config.seedEncKey,
        ctx,
        now,
      },
      staff.conductors,
    );
    await alignLedger(prisma);
    await rebuildCurrentSeason(prisma, app.get(RedisService), app.get(SeasonsService));
    await finishDemo(
      {
        prisma,
        events: app.get(EventEmitter2),
        notifications: app.get(NotificationsService),
        now,
      },
      staff.demoId,
      staff.chiefId,
    );
    await printSummary(prisma, rules);
  } finally {
    await app.close();
  }
}

async function publishedVersions(prisma: PrismaService): Promise<Map<string, number>> {
  const rows = await prisma.scenario.findMany({
    select: { id: true, currentVersion: true },
  });
  return new Map(rows.map((row) => [row.id, row.currentVersion]));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
