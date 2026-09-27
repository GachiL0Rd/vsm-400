import type { INestApplicationContext } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PasswordService } from '../../src/auth/password.service';
import { APP_CONFIG, type AppConfig } from '../../src/config/env';
import { SeasonsService } from '../../src/leaderboard/seasons.service';
import { NotificationsService } from '../../src/notifications/notifications.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { RedisService } from '../../src/redis/redis.service';
import { RulesService } from '../../src/rules/rules.service';
import { UsersService } from '../../src/users/users.service';
import { alignLedger } from './align-ledger';
import { finishDemo } from './demo-finish';
import { loadGameResults } from './fixtures';
import { seedHistory } from './history';
import { seedOrg } from './org';
import { assignPersonas, SEED_MARKER } from './personas';
import { rebuildCurrentSeason } from './season';
import { printSummary } from './summary';

/**
 * Повтор ничего не пишет, если уже есть логин demo1.
 * Очистку до --reset делает вызывающий: миграции не трогаем.
 */
export async function runSeed(app: INestApplicationContext): Promise<'skipped' | 'wrote'> {
  const prisma = app.get(PrismaService);
  const rules = app.get(RulesService);
  const marker = await prisma.user.findUnique({
    where: { login: SEED_MARKER },
    select: { id: true },
  });
  if (marker) {
    console.log('Маркер demo1 уже есть. Повтор без --reset ничего не пишет.');
    await printSummary(prisma, rules);
    return 'skipped';
  }
  const fixtures = loadGameResults();
  const personas = assignPersonas(fixtures);
  const now = new Date();
  const conductors = await seedOrg(
    {
      prisma,
      users: app.get(UsersService),
      passwords: app.get(PasswordService),
    },
    personas,
  );
  const config = app.get<AppConfig>(APP_CONFIG);
  await seedHistory(
    {
      prisma,
      events: app.get(EventEmitter2),
      seedKey: config.seedEncKey,
      now,
    },
    conductors,
    fixtures,
  );
  await alignLedger(prisma);
  await rebuildCurrentSeason(prisma, app.get(RedisService), app.get(SeasonsService));
  const demo = conductors.find((item) => item.login === SEED_MARKER);
  if (!demo) {
    throw new Error('Нет demo1');
  }
  await finishDemo(
    {
      prisma,
      notifications: app.get(NotificationsService),
      now,
    },
    demo.id,
  );
  await printSummary(prisma, rules);
  return 'wrote';
}
