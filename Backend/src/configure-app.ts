import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import { VersioningType } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { APP_CONFIG, type AppConfig } from './config/env';

// Swagger UI на Fastify сам регистрирует @fastify/static, пакет должен резолвиться.
import '@fastify/static';

/** Доменные ручки живут на /api/v1. Health и docs — без версии. */
export async function configureApp(app: NestFastifyApplication): Promise<void> {
  app.setGlobalPrefix('api');
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  // Swagger UI ставит inline-скрипты. Остальные заголовки helmet остаются.
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cookie);

  const config = app.get<AppConfig>(APP_CONFIG);
  app.enableCors({
    origin: config.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
  });
  app.enableShutdownHooks();

  const documentConfig = new DocumentBuilder()
    .setTitle('Перегон')
    .setDescription('API тренажёра проводника ВСМ')
    .setVersion('1')
    .addCookieAuth('vsm_access', { type: 'apiKey', in: 'cookie', name: 'vsm_access' }, 'vsm_access')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'bearer')
    .addApiKey({ type: 'apiKey', in: 'header', name: 'X-API-Key' }, 'api-key')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'opaque-service-token',
        description: 'Секрет Game Server. Значение — GAME_SERVER_TOKEN.',
      },
      'platform-service',
    )
    .build();
  // Документ Swagger — OpenAPI 3.0. Без cleanup nullable и z.literal уходят в синтаксис 3.1.
  const rawDocument = SwaggerModule.createDocument(app, documentConfig);
  // meta id и output-схема получают одно имя: $defs и parent-id. cleanup видит две разные схемы.
  releaseZodParentIds(rawDocument);
  const document = cleanupOpenApiDoc(rawDocument, { version: '3.0' });
  // Swagger вешается на Fastify мимо Nest, поэтому guard его не видит и @Public не нужен.
  SwaggerModule.setup('docs', app, document, {
    useGlobalPrefix: true,
    // useGlobalPrefix уже дописывает /api, поэтому здесь путь без префикса.
    jsonDocumentUrl: 'openapi.json',
  });
}

function releaseZodParentIds(document: OpenAPIObject): void {
  const schemas = document.components?.schemas;
  if (!schemas) {
    return;
  }
  for (const schema of Object.values(schemas)) {
    if (!schema || typeof schema !== 'object' || !('properties' in schema)) {
      continue;
    }
    const properties = schema.properties;
    if (!properties || typeof properties !== 'object') {
      continue;
    }
    const root = properties.root;
    if (!root || typeof root !== 'object') {
      continue;
    }
    const record = root as Record<string, unknown>;
    const parentId = record['x-nestjs_zod-parent-id'];
    const defs = record['x-nestjs_zod-$defs'];
    if (typeof parentId !== 'string' || !defs || typeof defs !== 'object' || !(parentId in defs)) {
      continue;
    }
    delete record['x-nestjs_zod-parent-id'];
  }
}
