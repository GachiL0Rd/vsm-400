import { randomUUID } from 'node:crypto';
import { Controller, type ExecutionContext, Get, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { IS_PUBLIC_KEY } from '../auth/public.decorator';
import { ROLES_KEY } from '../auth/roles.decorator';
import { Role } from '../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { ApiClientAuth } from './api-client-auth.decorator';
import { ApiClientsController } from './api-clients.controller';
import { formatApiKey, generateApiSecret, hashApiSecret } from './api-key';
import { ApiKeyGuard, type ApiRequest } from './api-key.guard';
import { API_SCOPES_KEY } from './api-scopes';

const id = randomUUID();
const secret = generateApiSecret();
const key = formatApiKey(id, secret);

function client(overrides?: { scopes?: string[]; revokedAt?: Date | null }) {
  return {
    id,
    name: 'hr',
    keyHash: hashApiSecret(secret),
    scopes: overrides?.scopes ?? ['employees:write'],
    revokedAt: overrides?.revokedAt ?? null,
  };
}

@Controller()
class ProbeController {
  @ApiClientAuth('employees:write')
  @Get()
  handle(): void {}
}

function context(request: ApiRequest): ExecutionContext {
  return {
    getHandler: () => ProbeController.prototype.handle,
    getClass: () => ProbeController,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

async function expectCode(
  guard: ApiKeyGuard,
  request: ApiRequest,
  status: number,
  code: string,
): Promise<void> {
  try {
    await guard.canActivate(context(request));
    expect.fail('guard должен отказать');
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    const http = error as HttpException;
    expect(http.getStatus()).toBe(status);
    expect(http.getResponse()).toMatchObject({ code });
  }
}

describe('ApiKeyGuard', () => {
  const reflector = new Reflector();

  it('помечает ручку публичной и требует scope', () => {
    expect(reflector.get(IS_PUBLIC_KEY, ProbeController.prototype.handle)).toBe(true);
    expect(reflector.get(API_SCOPES_KEY, ProbeController.prototype.handle)).toEqual([
      'employees:write',
    ]);
    expect(reflector.get(ROLES_KEY, ApiClientsController.prototype.create)).toEqual([Role.ADMIN]);
  });

  it('нет ключа, неверный, чужой scope и отзыв', async () => {
    const findUnique = vi.fn();
    const guard = new ApiKeyGuard(reflector, {
      apiClient: { findUnique },
    } as unknown as PrismaService);

    await expectCode(guard, { headers: {} }, 401, 'API_KEY_MISSING');
    expect(findUnique).not.toHaveBeenCalled();

    await expectCode(guard, { headers: { 'x-api-key': 'vsm_nope' } }, 401, 'API_KEY_INVALID');

    findUnique.mockResolvedValue(null);
    await expectCode(guard, { headers: { 'x-api-key': key } }, 401, 'API_KEY_INVALID');

    findUnique.mockResolvedValue(client());
    const wrong = formatApiKey(id, generateApiSecret());
    await expectCode(guard, { headers: { 'x-api-key': wrong } }, 401, 'API_KEY_INVALID');

    findUnique.mockResolvedValue(client({ revokedAt: new Date() }));
    await expectCode(guard, { headers: { 'x-api-key': wrong } }, 401, 'API_KEY_INVALID');
    await expectCode(guard, { headers: { 'x-api-key': key } }, 401, 'API_KEY_REVOKED');

    findUnique.mockResolvedValue(client({ scopes: ['org:read'] }));
    await expectCode(guard, { headers: { 'x-api-key': key } }, 403, 'API_KEY_SCOPE');

    const request: ApiRequest = { headers: { 'x-api-key': key } };
    findUnique.mockResolvedValue(client());
    await expect(guard.canActivate(context(request))).resolves.toBe(true);
    expect(request.apiClient).toEqual({ id, name: 'hr', scopes: ['employees:write'] });
    expect(request.apiClient).not.toHaveProperty('keyHash');
  });
});
