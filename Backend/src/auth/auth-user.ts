import type { Role } from '../generated/prisma/client';

/**
 * Кто уже прошёл глобальный guard.
 * Guard один на приложение: без @Public() ручка требует логин
 * (cookie vsm_access или Bearer), @Roles() сужает роль,
 * @CurrentUser() достаёт этого пользователя из request.
 * Сам guard — задача AUTH, здесь только контракт для остальных модулей.
 */
export interface AuthUser {
  id: string;
  role: Role;
  /** null, пока учётку не посадили в бригаду. */
  brigadeId: string | null;
  /** Депо бригады. В таблице users колонки нет — guard берёт его из Brigade. */
  depotId: string | null;
}
