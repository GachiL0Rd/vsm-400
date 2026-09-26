import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import { VersioningType } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
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
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Service-Token'],
  });
  app.enableShutdownHooks();

  const documentConfig = new DocumentBuilder()
    .setTitle('Перегон')
    .setDescription('API тренажёра проводника ВСМ')
    .setVersion('1')
    .addCookieAuth('vsm_access', { type: 'apiKey', in: 'cookie', name: 'vsm_access' }, 'vsm_access')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'bearer')
    .addApiKey({ type: 'apiKey', in: 'header', name: 'X-API-Key' }, 'api-key')
    .addApiKey({ type: 'apiKey', in: 'header', name: 'X-Service-Token' }, 'service-token')
    .build();
  const document = SwaggerModule.createDocument(app, documentConfig);
  SwaggerModule.setup('docs', app, document, {
    useGlobalPrefix: true,
    // useGlobalPrefix уже дописывает /api, поэтому здесь путь без префикса.
    jsonDocumentUrl: 'openapi.json',
  });
}
