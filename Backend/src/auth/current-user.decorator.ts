import { createParamDecorator, type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { AuthUser } from './auth-user';

/** Пустой request.user — 401: хендлер не должен работать без уже проверенного пользователя. */
export function readCurrentUser(_data: unknown, ctx: ExecutionContext): AuthUser {
  const request = ctx.switchToHttp().getRequest<{ user?: AuthUser }>();
  if (!request.user) {
    throw new UnauthorizedException('Нужна аутентификация');
  }
  return request.user;
}

export const CurrentUser = createParamDecorator(readCurrentUser);
