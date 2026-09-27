import { describe, expect, it } from 'vitest';
import {
  ACCESS_TTL_SEC,
  accessCookieOptions,
  REFRESH_PATH,
  REFRESH_TTL_SEC,
  refreshCookieOptions,
} from './cookies';

describe('cookies', () => {
  it('ставит флаги access и refresh из SPEC', () => {
    expect(accessCookieOptions(true)).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: ACCESS_TTL_SEC,
    });
    expect(refreshCookieOptions(false)).toEqual({
      httpOnly: true,
      secure: false,
      sameSite: 'strict',
      path: REFRESH_PATH,
      maxAge: REFRESH_TTL_SEC,
    });
    expect(ACCESS_TTL_SEC).toBe(15 * 60);
    expect(REFRESH_TTL_SEC).toBe(7 * 24 * 60 * 60);
  });
});
