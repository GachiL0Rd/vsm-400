import { describe, expect, it } from 'vitest';
import { acquireCronLock, cronLockKey, cronWindow } from './cron-lock';

describe('cronWindow', () => {
  it('сутки и минута считаются по Москве', () => {
    const midnight = new Date('2026-09-28T00:00:00+03:00');
    expect(cronWindow(midnight, 'day')).toBe('2026-09-28');
    expect(cronWindow(midnight, 'minute')).toBe('2026-09-28T00:00');
    expect(cronWindow(new Date('2026-09-27T21:05:00Z'), 'minute')).toBe('2026-09-28T00:05');
  });
});

describe('acquireCronLock', () => {
  it('первый в окне берёт ключ, второй нет, другое окно — снова да', async () => {
    const keys = new Map<string, { value: string; ttlMs: number }>();
    const redis = {
      set: async (
        key: string,
        value: string,
        expiry: 'PX',
        ttlMs: number,
        mode: 'NX',
      ): Promise<string | null> => {
        expect(expiry).toBe('PX');
        expect(mode).toBe('NX');
        expect(ttlMs).toBe(1_000);
        if (keys.has(key)) {
          return null;
        }
        keys.set(key, { value, ttlMs });
        return 'OK';
      },
    };
    expect(await acquireCronLock(redis, 'social-season-close', '2026-09-28', 1_000)).toBe(true);
    expect(await acquireCronLock(redis, 'social-season-close', '2026-09-28', 1_000)).toBe(false);
    expect(await acquireCronLock(redis, 'social-season-close', '2026-10-05', 1_000)).toBe(true);
    expect(keys.get(cronLockKey('social-season-close', '2026-09-28'))).toEqual({
      value: '1',
      ttlMs: 1_000,
    });
  });
});
