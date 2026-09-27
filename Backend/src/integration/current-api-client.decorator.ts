import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { ApiClientContext, ApiRequest } from './api-key.guard';
import { httpError } from './http-error';

export const CurrentApiClient = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ApiClientContext => {
    const request = ctx.switchToHttp().getRequest<ApiRequest>();
    if (!request.apiClient) {
      throw httpError(401, 'Нет ключа API', 'API_KEY_MISSING');
    }
    return request.apiClient;
  },
);
