import { Controller, type ExecutionContext, Get, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { Role } from '../generated/prisma/client';
import type { AuthUser } from './auth-user';
import { readCurrentUser } from './current-user.decorator';
import { IS_PUBLIC_KEY, Public } from './public.decorator';
import { ROLES_KEY, Roles } from './roles.decorator';

const user: AuthUser = {
  id: '018f1a2b-3c4d-7e5f-8a9b-0c1d2e3f4a5b',
  role: Role.CONDUCTOR,
  brigadeId: null,
  depotId: null,
};

function context(current?: AuthUser): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user: current }),
    }),
  } as unknown as ExecutionContext;
}

@Controller()
class ProbeController {
  @Public()
  @Roles(Role.ADMIN, Role.CHIEF)
  @Get()
  handler(): void {}
}

describe('декораторы доступа', () => {
  const reflector = new Reflector();

  it('вешает isPublic и список ролей на метод', () => {
    expect(reflector.get(IS_PUBLIC_KEY, ProbeController.prototype.handler)).toBe(true);
    expect(reflector.get(ROLES_KEY, ProbeController.prototype.handler)).toEqual([
      Role.ADMIN,
      Role.CHIEF,
    ]);
  });

  it('отдаёт request.user', () => {
    expect(readCurrentUser(undefined, context(user))).toBe(user);
  });

  it('без пользователя бросает 401', () => {
    expect(() => readCurrentUser(undefined, context())).toThrow(UnauthorizedException);
  });
});
