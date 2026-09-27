import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { resetDomain } from './seed/reset';
import { runSeed } from './seed/run-seed';

/**
 * Повтор без --reset ничего не пишет, если уже есть логин demo1.
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
    await runSeed(app);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
