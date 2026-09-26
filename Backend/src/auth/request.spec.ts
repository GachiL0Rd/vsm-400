import { describe, expect, it } from 'vitest';
import { loginTracker, passwordChangeAllows } from './request';

describe('пути и ключ throttler', () => {
  it('отличает смену пароля от остальных ручек', () => {
    expect(passwordChangeAllows('/api/v1/auth/password')).toBe(true);
    expect(passwordChangeAllows('/api/v1/me')).toBe(true);
    expect(passwordChangeAllows('/api/v1/me/stats')).toBe(true);
    expect(passwordChangeAllows('/api/v1/org/depots')).toBe(false);
    expect(passwordChangeAllows('/api/v1/methodist')).toBe(false);
  });

  it('ключит лимит по IP и логину', () => {
    const left = loginTracker({ ip: '10.0.0.1', body: { login: ' admin ' } });
    const right = loginTracker({ ip: '10.0.0.1', body: { login: 'other' } });
    expect(left).toBe('10.0.0.1:admin');
    expect(right).not.toBe(left);
    expect(loginTracker({ body: {} })).toBe('unknown:');
  });
});
