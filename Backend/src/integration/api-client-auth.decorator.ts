import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { ApiKeyGuard } from './api-key.guard';
import { API_SCOPES_KEY, type ApiScope } from './api-scopes';

/** Глобальный JWT-guard увидит @Public и пропустит ручку. Дальше решает ApiKeyGuard. */

export function ApiClientAuth(...scopes: ApiScope[]) {
  return applyDecorators(Public(), SetMetadata(API_SCOPES_KEY, scopes), UseGuards(ApiKeyGuard));
}
