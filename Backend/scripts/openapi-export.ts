import 'reflect-metadata';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';

/**
 * Пишет OpenAPI в файл или в stdout.
 * По умолчанию dist/openapi.json — каталог сборки, в git не входит.
 * `npm run openapi:export -- -` печатает документ в stdout.
 */
async function main(): Promise<void> {
  const target = process.argv[2] ?? 'dist/openapi.json';
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ bodyLimit: 1_048_576 }),
    { logger: ['error'] },
  );
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  const response = await app.getHttpAdapter().getInstance().inject({
    method: 'GET',
    url: '/api/openapi.json',
  });
  if (response.statusCode !== 200) {
    throw new Error(`GET /api/openapi.json → ${response.statusCode}`);
  }
  const body = response.body.endsWith('\n') ? response.body : `${response.body}\n`;
  if (target === '-') {
    process.stdout.write(body);
  } else {
    const file = path.resolve(target);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, body);
    process.stderr.write(`openapi → ${file}\n`);
  }
  await app.close();
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
