import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { APP_CONFIG, type AppConfig, loadConfig } from './config/env';
import { configureApp } from './configure-app';
import { createFastifyAdapter } from './http-adapter';

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

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
