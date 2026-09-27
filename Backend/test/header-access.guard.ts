import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthUser } from '../src/auth/auth-user';
import { IS_PUBLIC_KEY } from '../src/auth/public.decorator';

const ROLES = new Set(['CONDUCTOR', 'CHIEF', 'METHODIST', 'ADMIN']);

/**
 * Подмена глобального AccessGuard: читает тестовые заголовки и уважает @Public.
 * Роли по-прежнему проверяет настоящий RolesGuard.
 */
@Injectable()
export class HeaderAccessGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets) === true) {
      return true;
    }
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      user?: AuthUser;
    }>();
    const rawUser = oneHeader(request.headers['x-test-user']);
    if (rawUser) {
      request.user = JSON.parse(rawUser) as AuthUser;
      return true;
    }
    const role = oneHeader(request.headers['x-test-role']);
    const actor = oneHeader(request.headers['x-test-actor']);
    if (role && ROLES.has(role) && actor) {
      request.user = {
        id: actor,
        role: role as AuthUser['role'],
        brigadeId: null,
        depotId: null,
      };
      return true;
    }
    throw new UnauthorizedException({
      message: 'Нужна аутентификация',
      code: 'UNAUTHENTICATED',
    });
  }
}

function oneHeader(value: string | string[] | undefined): string | undefined {
  const header = Array.isArray(value) ? value[0] : value;
  return typeof header === 'string' && header.length > 0 ? header : undefined;
}
