import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthUser } from '../auth/auth-user';
import { IS_PUBLIC_KEY } from '../auth/public.decorator';
import { ROLES_KEY } from '../auth/roles.decorator';
import { type Role, Role as RoleName } from '../generated/prisma/client';

@Injectable()
export class AccessGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (this.isPublic(context)) {
      return true;
    }
    const user = this.readUser(context);
    this.assertRole(context, user.role);
    return true;
  }

  private isPublic(context: ExecutionContext): boolean {
    return (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) === true
    );
  }

  private readUser(context: ExecutionContext): AuthUser {
    const request = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    if (!request.user) {
      throw new UnauthorizedException({
        message: 'Нужна аутентификация',
        code: 'UNAUTHORIZED',
      });
    }
    return request.user;
  }

  private assertRole(context: ExecutionContext, role: Role): void {
    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (roles && roles.length > 0 && !roles.includes(role)) {
      throw new ForbiddenException({ message: 'Недостаточно прав', code: 'FORBIDDEN' });
    }
  }
}

/** CHIEF видит только свою бригаду. METHODIST и ADMIN — любую. */
export function assertBrigadeAccess(actor: AuthUser, brigadeId: string): void {
  if (actor.role === RoleName.METHODIST || actor.role === RoleName.ADMIN) {
    return;
  }
  if (actor.role === RoleName.CHIEF && actor.brigadeId !== null && actor.brigadeId === brigadeId) {
    return;
  }
  throw new ForbiddenException({
    message: 'Нет доступа к этой бригаде',
    code: 'FORBIDDEN_BRIGADE',
  });
}
