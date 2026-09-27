import type { CookieOptions } from '../auth/cookies';

export const GAME_COOKIE = 'vsm_game';
export const GAME_COOKIE_PATH = '/game-ws';
export const TICKET_TTL_SEC = 2 * 60;
export const TICKET_REDIS_TTL_SEC = 300;
export const SESSION_TTL_MS = 2 * 60 * 60 * 1000;

export function gameCookieOptions(secure: boolean): CookieOptions {
  return {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: GAME_COOKIE_PATH,
    maxAge: TICKET_TTL_SEC,
  };
}
