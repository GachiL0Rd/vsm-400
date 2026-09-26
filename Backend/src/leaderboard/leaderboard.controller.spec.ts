import { VersioningType } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { ZodValidationPipe } from 'nestjs-zod';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../auth/auth-user';
import { ProblemFilter } from '../common/problem.filter';
import { Role } from '../generated/prisma/client';
import { LeaderboardController } from './leaderboard.controller';
import { LeaderboardService } from './leaderboard.service';

const user: AuthUser = {
  id: '018f1a2b-3c4d-7e5f-8a9b-0c1d2e3f4a5b',
  role: Role.CONDUCTOR,
  brigadeId: 'brigade-1',
  depotId: 'depot-1',
};

describe('HTTP рейтинга', () => {
  let app: NestFastifyApplication;
  const board = vi.fn(async () => ({
    seasonId: '018f1a2b-3c4d-7e5f-8a9b-0c1d2e3f4a5b',
    season: 'Сезон 39',
    endsAt: '2026-09-27T20:59:59.999Z',
    total: 1,
    rows: [{ rank: 1, callsign: 'A7F3', points: 10, move: 2, me: true }],
  }));
  const place = vi.fn(async () => ({ rank: 2, total: 14 }));

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [LeaderboardController],
      providers: [{ provide: LeaderboardService, useValue: { board, brigadePlace: place } }],
    }).compile();
    app = moduleRef.createNestApplication(new FastifyAdapter({ bodyLimit: 1_048_576 }), {
      logger: false,
    });
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new ZodValidationPipe());
    app.useGlobalFilters(new ProblemFilter());
    const fastify = app.getHttpAdapter().getInstance();
    fastify.addHook('onRequest', (request, _reply, done) => {
      const headers = request.headers as { 'x-test-user'?: string | string[] };
      if (headers['x-test-user'] !== '0') {
        (request as { user?: AuthUser }).user = user;
      }
      done();
    });
    await app.init();
    await fastify.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('место бригады не путается со scope', async () => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: 'GET',
      url: '/api/v1/leaderboards/brigades',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ rank: 2, total: 14 });
    expect(place).toHaveBeenCalledOnce();
    expect(board).not.toHaveBeenCalled();
  });

  it('отдаёт рейтинг депо', async () => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: 'GET',
      url: '/api/v1/leaderboards/depot',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      seasonId: '018f1a2b-3c4d-7e5f-8a9b-0c1d2e3f4a5b',
      season: 'Сезон 39',
      total: 1,
      rows: [{ me: true, move: 2 }],
    });
  });

  it('query season передаёт id сезона', async () => {
    const seasonId = '018f1a2b-3c4d-7e5f-8a9b-0c1d2e3f4a5c';
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'GET',
        url: `/api/v1/leaderboards/depot?season=${seasonId}`,
      });
    expect(response.statusCode).toBe(200);
    expect(board).toHaveBeenCalledWith(user, 'depot', seasonId);
  });

  it('без пользователя 401, кривой сезон 422', async () => {
    const anonymous = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'GET',
        url: '/api/v1/leaderboards/company',
        headers: { 'x-test-user': '0' },
      });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.headers['content-type']).toContain('application/problem+json');

    const bad = await app.getHttpAdapter().getInstance().inject({
      method: 'GET',
      url: '/api/v1/leaderboards/company?season=nope',
    });
    expect(bad.statusCode).toBe(422);
    expect(bad.json()).toMatchObject({ code: 'VALIDATION' });
  });
});
