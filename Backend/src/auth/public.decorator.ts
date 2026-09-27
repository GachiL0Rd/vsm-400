import { SetMetadata } from '@nestjs/common';

/** Глобальный guard пропускает ручку без логина, если видит этот ключ. */
export const IS_PUBLIC_KEY = 'isPublic';

export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
