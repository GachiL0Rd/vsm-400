import type { ExecutionContext } from '@nestjs/common';
import { seconds, type ThrottlerOptions } from '@nestjs/throttler';
import {
  AUTH_IP_LIMIT,
  AUTH_LOGIN_LIMIT,
  AUTH_PASSWORD_LIMIT,
  loginRateKey,
  passwordRateKey,
  requestPath,
  throttleIp,
} from './request';

function pathOf(context: ExecutionContext): string {
  const request = context.switchToHttp().getRequest<{ url?: string }>();
  return requestPath(request.url ?? '');
}

export function authThrottlers(): ThrottlerOptions[] {
  return [
    {
      name: 'ip',
      limit: AUTH_IP_LIMIT,
      ttl: seconds(60),
      getTracker: (req: { ip?: string }) => throttleIp(req.ip),
    },
    {
      name: 'login',
      limit: AUTH_LOGIN_LIMIT,
      ttl: seconds(60),
      getTracker: (req: { body?: unknown }) => loginRateKey(req.body),
      skipIf: (context) => pathOf(context) !== '/api/v1/auth/login',
    },
    {
      name: 'password',
      limit: AUTH_PASSWORD_LIMIT,
      ttl: seconds(60),
      getTracker: (req: { user?: { id?: string }; ip?: string }) => passwordRateKey(req),
      skipIf: (context) => pathOf(context) !== '/api/v1/auth/password',
    },
  ];
}
