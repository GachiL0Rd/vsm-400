import { applyDecorators, UseGuards } from '@nestjs/common';
import { ApiSecurity } from '@nestjs/swagger';
import { Public } from './public.decorator';
import { ServiceTokenGuard } from './service-token.guard';

/**
 * Internal API (/api/internal/v1): без пользовательского JWT, с X-Service-Token.
 * AuthModule глобальный, guard доступен остальным модулям после импорта.
 */
export function InternalService(): ClassDecorator & MethodDecorator {
  return applyDecorators(Public(), UseGuards(ServiceTokenGuard), ApiSecurity('service-token'));
}
