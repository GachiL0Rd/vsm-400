import {
  Controller,
  type ExecutionContext,
  ForbiddenException,
  Get,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { JwtService } from '@nestjs/jwt';
import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../config/env';
import { Role } from '../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { AccessGuard } from './access.guard';
import { InternalService } from './internal-service.decorator';
import { Public } from './public.decorator';
import { Roles } from './roles.decorator';
import { RolesGuard } from './roles.guard';
import { ServiceTokenGuard } from './service-token.guard';

const userId = '018f1a2b-3c4d-7e5f-8a9b-0c1d2e3f4a5b';

@Controller()
class Probe {
  @Public()
  @Get()
  open(): void {}

  @Get()
  closed(): void {}

  @Roles(Role.ADMIN)
  @Get()
  adminOnly(): void {}

  @InternalService()
  @Get()
  internal(): void {}
}

function context(request: Record<string, unknown>, handler: () => void): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => Probe,
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({}),
    }),
  } as unknown as ExecutionContext;
}

function claims() {
  return { sub: userId, role: Role.CONDUCTOR, bid: null, did: null };
}

describe('AccessGuard', () => {
  const reflector = new Reflector();
  const verifyAsync = vi.fn();
  const findUnique = vi.fn();
  const guard = new AccessGuard(
    reflector,
    { verifyAsync } as unknown as JwtService,
    { user: { findUnique } } as unknown as PrismaService,
  );

  it('пропускает @Public и служебные пути без токена', async () => {
    await expect(
      guard.canActivate(context({ url: '/api/v1/auth/login' }, Probe.prototype.open)),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(context({ url: '/api/health' }, Probe.prototype.closed)),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(context({ url: '/api/docs/swagger-ui.css' }, Probe.prototype.closed)),
    ).resolves.toBe(true);
    expect(verifyAsync).not.toHaveBeenCalled();
  });

  it('без токена отвечает 401', async () => {
    await expect(
      guard.canActivate(
        context({ url: '/api/v1/auth/session', headers: {} }, Probe.prototype.closed),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('кладёт AuthUser и пускает bearer', async () => {
    verifyAsync.mockResolvedValueOnce(claims());
    findUnique.mockResolvedValueOnce({
      id: userId,
      role: Role.CHIEF,
      brigadeId: 'brigade-1',
      mustChangePassword: false,
      disabledAt: null,
      brigade: { depotId: 'depot-1' },
    });
    const request: Record<string, unknown> = {
      url: '/api/v1/org/depots',
      headers: { authorization: 'Bearer access-token' },
      cookies: { vsm_access: 'cookie-token' },
    };
    await expect(guard.canActivate(context(request, Probe.prototype.closed))).resolves.toBe(true);
    expect(verifyAsync).toHaveBeenCalledWith('access-token', { algorithms: ['HS256'] });
    expect(request.user).toEqual({
      id: userId,
      role: Role.CHIEF,
      brigadeId: 'brigade-1',
      depotId: 'depot-1',
    });
  });

  it('mustChangePassword закрывает всё кроме /auth и /me', async () => {
    findUnique.mockResolvedValue({
      id: userId,
      role: Role.ADMIN,
      brigadeId: null,
      mustChangePassword: true,
      disabledAt: null,
      brigade: null,
    });
    verifyAsync.mockResolvedValue(claims());
    const blocked = guard.canActivate(
      context(
        { url: '/api/v1/org/depots', headers: { authorization: 'Bearer t' } },
        Probe.prototype.closed,
      ),
    );
    await expect(blocked).rejects.toBeInstanceOf(ForbiddenException);
    await expect(blocked).rejects.toMatchObject({
      response: { code: 'PASSWORD_CHANGE_REQUIRED' },
    });
    await expect(
      guard.canActivate(
        context(
          { url: '/api/v1/auth/password', headers: { authorization: 'Bearer t' } },
          Probe.prototype.closed,
        ),
      ),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(
        context(
          { url: '/api/v1/me/stats', headers: { authorization: 'Bearer t' } },
          Probe.prototype.closed,
        ),
      ),
    ).resolves.toBe(true);
  });
});

describe('RolesGuard', () => {
  const guard = new RolesGuard(new Reflector());

  it('без @Roles пускает, чужая роль — 403, @Public не смотрит роль', () => {
    const user = { id: userId, role: Role.CONDUCTOR, brigadeId: null, depotId: null };
    expect(guard.canActivate(context({ user }, Probe.prototype.closed))).toBe(true);
    expect(() => guard.canActivate(context({ user }, Probe.prototype.adminOnly))).toThrow(
      ForbiddenException,
    );
    expect(
      guard.canActivate(
        context({ user: { ...user, role: Role.ADMIN } }, Probe.prototype.adminOnly),
      ),
    ).toBe(true);
    expect(guard.canActivate(context({}, Probe.prototype.open))).toBe(true);
  });
});

describe('ServiceTokenGuard', () => {
  const guard = new ServiceTokenGuard({
    gameServerToken: 'local-dev-game-server-token',
  } as AppConfig);

  function withHeader(value?: string): ExecutionContext {
    return context(
      { headers: value === undefined ? {} : { 'x-service-token': value } },
      Probe.prototype.internal,
    );
  }

  it('сверяет X-Service-Token и не падает на другой длине', () => {
    expect(guard.canActivate(withHeader('local-dev-game-server-token'))).toBe(true);
    expect(() => guard.canActivate(withHeader('nope'))).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(withHeader('x'))).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(withHeader())).toThrow(UnauthorizedException);
  });
});

describe('@InternalService', () => {
  const reflector = new Reflector();

  it('это публичный маршрут с ServiceTokenGuard', () => {
    expect(reflector.get('isPublic', Probe.prototype.internal)).toBe(true);
    expect(reflector.get('__guards__', Probe.prototype.internal)).toEqual([ServiceTokenGuard]);
  });
});
