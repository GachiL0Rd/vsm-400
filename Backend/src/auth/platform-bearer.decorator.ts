import { applyDecorators, UseGuards } from '@nestjs/common';
import { ApiSecurity } from '@nestjs/swagger';
import { PlatformServiceGuard } from './platform-service.guard';
import { Public } from './public.decorator';

/**
 * Platform API (/api/game): без пользовательского JWT, с Bearer GAME_SERVER_TOKEN.
 * AuthModule глобальный, guard доступен остальным модулям после импорта.
 */
export function PlatformBearer(): ClassDecorator & MethodDecorator {
  return applyDecorators(
    Public(),
    UseGuards(PlatformServiceGuard),
    ApiSecurity('platform-service'),
  );
}
