import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { APP_CONFIG, type AppConfig, fastifyTrustProxy, loadConfig } from './config/env';
import { configureApp } from './configure-app';

export const BODY_LIMIT_BYTES = 1_048_576;

export function createFastifyAdapter(trustProxy: false | string = false): FastifyAdapter {
  return new FastifyAdapter({
    bodyLimit: BODY_LIMIT_BYTES,
    trustProxy: fastifyTrustProxy(trustProxy),
  });
}

async function bootstrap(): Promise<void> {
  const bootConfig = loadConfig();
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    createFastifyAdapter(bootConfig.trustProxy),
  );
  await configureApp(app);
  const config = app.get<AppConfig>(APP_CONFIG);
  await app.listen({ port: config.port, host: '0.0.0.0' });
}

// Импорт createFastifyAdapter из теста не должен слушать порт.
if (process.env.NODE_ENV !== 'test') {
  bootstrap().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}
