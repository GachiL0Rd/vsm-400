import { describe, expect, it } from 'vitest';
import { loginTracker, passwordChangeAllows } from './request';

describe('пути и ключ throttler', () => {
  it('пускает только смену пароля, выход и чтение сессии', () => {
    expect(passwordChangeAllows('POST', '/api/v1/auth/password')).toBe(true);
    expect(passwordChangeAllows('POST', '/api/v1/auth/password/')).toBe(true);
    expect(passwordChangeAllows('POST', '/api/v1/auth/password?next=/me')).toBe(true);
    expect(passwordChangeAllows('POST', '/api/v1/auth/logout')).toBe(true);
    expect(passwordChangeAllows('GET', '/api/v1/auth/session')).toBe(true);
    expect(passwordChangeAllows('GET', '/api/v1/auth/password')).toBe(false);
    expect(passwordChangeAllows('POST', '/api/v1/auth/login')).toBe(false);
    expect(passwordChangeAllows('POST', '/api/v1/auth/password/extra')).toBe(false);
    expect(passwordChangeAllows('GET', '/api/v1/me')).toBe(false);
    expect(passwordChangeAllows('GET', '/api/v1/me/stats')).toBe(false);
    expect(passwordChangeAllows('GET', '/api/v1/org/depots')).toBe(false);
    expect(passwordChangeAllows('GET', '/api/v1/methodist')).toBe(false);
    expect(passwordChangeAllows('POST', '/api/v1/not/auth/password')).toBe(false);
  });

  it('ключит лимит по IP и логину', () => {
    const left = loginTracker({ ip: '10.0.0.1', body: { login: ' admin ' } });
    const right = loginTracker({ ip: '10.0.0.1', body: { login: 'other' } });
    expect(left).toBe('10.0.0.1:admin');
    expect(right).not.toBe(left);
    expect(loginTracker({ body: {} })).toBe('unknown:');
  });
});
