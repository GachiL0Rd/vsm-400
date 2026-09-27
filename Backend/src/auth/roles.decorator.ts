import { SetMetadata } from '@nestjs/common';
import type { Role } from '../generated/prisma/client';

/** Глобальный guard пускает только эти роли. Ключ читает задача AUTH. */
export const ROLES_KEY = 'roles';

export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
