import { ForbiddenException } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user';

const editors = new Set<AuthUser['role']>(['METHODIST', 'ADMIN']);

/** Декоратор @Roles подхватит guard задачи AUTH. Пока его нет — проверка здесь. */
export function assertScenarioEditor(user: AuthUser): void {
  if (!editors.has(user.role)) {
    throw new ForbiddenException({
      message: 'Нужна роль методиста или администратора',
      code: 'FORBIDDEN',
    });
  }
}
