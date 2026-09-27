import { ForbiddenException } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user';
import { Role as RoleName } from '../generated/prisma/client';

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
