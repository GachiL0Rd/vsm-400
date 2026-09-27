import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/env';

export const ACCESS_COOKIE = 'vsm_access';
export const REFRESH_COOKIE = 'vsm_refresh';
export const ACCESS_TTL_SEC = 15 * 60;
export const REFRESH_TTL_SEC = 7 * 24 * 60 * 60;
export const REFRESH_PATH = '/api/v1/auth';

export type CookieOptions = {
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax' | 'strict';
  path: string;
  maxAge: number;
};

export type CookieReply = {
  setCookie(name: string, value: string, options: CookieOptions): void;
  clearCookie(name: string, options: CookieOptions): void;
};

export function accessCookieOptions(secure: boolean): CookieOptions {
  return {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: ACCESS_TTL_SEC,
  };
}

export function refreshCookieOptions(secure: boolean): CookieOptions {
  return {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: REFRESH_PATH,
    maxAge: REFRESH_TTL_SEC,
  };
}

@Injectable()
export class AuthCookies {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  write(reply: CookieReply, access: string, refresh: string): void {
    const secure = this.config.cookieSecure;
    reply.setCookie(ACCESS_COOKIE, access, accessCookieOptions(secure));
    reply.setCookie(REFRESH_COOKIE, refresh, refreshCookieOptions(secure));
  }

  clear(reply: CookieReply): void {
    const secure = this.config.cookieSecure;
    reply.clearCookie(ACCESS_COOKIE, { ...accessCookieOptions(secure), maxAge: 0 });
    reply.clearCookie(REFRESH_COOKIE, { ...refreshCookieOptions(secure), maxAge: 0 });
  }
}
