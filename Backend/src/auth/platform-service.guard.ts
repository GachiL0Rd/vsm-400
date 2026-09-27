import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/env';
import { tokenEquals } from './token';

/** Game Server ходит с Authorization: Bearer. Секрет — GAME_SERVER_TOKEN. */
@Injectable()
export class PlatformServiceGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
    }>();
    const provided = bearerToken(request.headers.authorization);
    if (!tokenEquals(provided, this.config.gameServerToken)) {
      throw new UnauthorizedException({
        message: 'Неверный сервисный токен',
        code: 'INVALID_PLATFORM_TOKEN',
      });
    }
    return true;
  }
}

function bearerToken(header: string | string[] | undefined): string {
  if (typeof header !== 'string') {
    return '';
  }
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1] ?? '';
}
