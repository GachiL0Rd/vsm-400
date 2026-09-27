import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';

import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';
import { ScenariosService } from '../src/scenarios/scenarios.service';

function createFastifyAdapter(): FastifyAdapter {
  return new FastifyAdapter({ bodyLimit: 1_048_576 });
}

describe('GET /api/health', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({
        $queryRaw: vi.fn().mockResolvedValue([1]),
        $connect: vi.fn(),
        $disconnect: vi.fn(),
      })
      .overrideProvider(RedisService)
      .useValue({
        ping: vi.fn().mockResolvedValue('PONG'),
        quit: vi.fn(),
        connect: vi.fn(),
      })
      .overrideProvider(ScenariosService)
      .useValue({ onApplicationBootstrap: () => undefined })
      .compile();

    app = moduleRef.createNestApplication(createFastifyAdapter(), { logger: false });
    await configureApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('отвечает ok, когда postgres и redis живы', async () => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: 'GET',
      url: '/api/health',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'ok',
      details: {
        database: { status: 'up' },
        redis: { status: 'up' },
      },
    });
  });

  it('неизвестный путь — problem+json', async () => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: 'GET',
      url: '/api/missing',
    });
    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json()).toMatchObject({ status: 404, code: 'HTTP_404' });
  });

  it('отдаёт swagger и схемы безопасности', async () => {
    const docs = await app.getHttpAdapter().getInstance().inject({
      method: 'GET',
      url: '/api/docs',
    });
    expect(docs.statusCode).toBe(200);
    expect(docs.body).toContain('swagger');

    const spec = await app.getHttpAdapter().getInstance().inject({
      method: 'GET',
      url: '/api/openapi.json',
    });
    expect(spec.statusCode).toBe(200);
    const document = spec.json() as {
      paths: Record<string, unknown>;
      components: { securitySchemes: Record<string, { name?: string; type?: string }> };
    };
    expect(document.paths['/api/health']).toBeDefined();
    expect(document.components.securitySchemes.vsm_access?.name).toBe('vsm_access');
    expect(document.components.securitySchemes.bearer?.type).toBe('http');
    expect(document.components.securitySchemes['api-key']?.name).toBe('X-API-Key');
    expect(document.components.securitySchemes['service-token']?.name).toBe('X-Service-Token');
  });
});
