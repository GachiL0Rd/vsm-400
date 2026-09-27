import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/env';
import { tokenEquals } from './token';

@Injectable()
export class ServiceTokenGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
    }>();
    const header = request.headers['x-service-token'];
    const provided = typeof header === 'string' ? header : '';
    if (!tokenEquals(provided, this.config.gameServerToken)) {
      throw new UnauthorizedException({
        message: 'Неверный сервисный токен',
        code: 'INVALID_SERVICE_TOKEN',
      });
    }
    return true;
  }
}
