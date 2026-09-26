import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { APP_CONFIG, type AppConfig, loadConfig } from './config/env';
import { configureApp } from './configure-app';

export const BODY_LIMIT_BYTES = 1_048_576;

export function createFastifyAdapter(): FastifyAdapter {
  return new FastifyAdapter({ bodyLimit: BODY_LIMIT_BYTES });
}

async function bootstrap(): Promise<void> {
  loadConfig();
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, createFastifyAdapter());
  await configureApp(app);
  const config = app.get<AppConfig>(APP_CONFIG);
  await app.listen({ port: config.port, host: '0.0.0.0' });
}

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
