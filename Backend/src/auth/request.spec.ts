import { describe, expect, it } from 'vitest';
import { loginRateKey, passwordChangeAllows, passwordRateKey, throttleIp } from './request';

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

  it('режет IPv6 до /64 и не даёт длинному логину плодить ключи', () => {
    expect(throttleIp('10.0.0.1')).toBe('10.0.0.1');
    expect(throttleIp('::ffff:10.1.2.3')).toBe('10.1.2.3');
    expect(throttleIp(undefined)).toBe('unknown');
    const left = throttleIp('2001:db8:1:2::1');
    const right = throttleIp('2001:db8:1:2::abcd');
    expect(left).toBe(right);
    expect(left).toBe('2001:0db8:0001:0002::/64');
    expect(throttleIp('2001:db8:1:3::1')).not.toBe(left);
    expect(loginRateKey({ login: ' admin ' })).toBe('admin');
    expect(loginRateKey({ login: `  ${'a'.repeat(80)}` })).toHaveLength(64);
    expect(loginRateKey({ login: 1 })).toBe('');
    expect(loginRateKey(null)).toBe('');
    expect(passwordRateKey({ user: { id: 'user-1' }, ip: '10.0.0.1' })).toBe('user-1');
    expect(passwordRateKey({ ip: '10.0.0.8' })).toBe('10.0.0.8');
  });
});
