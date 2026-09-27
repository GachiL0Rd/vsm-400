import { describe, expect, it, vi } from 'vitest';
import { RedisThrottlerStorage } from './redis-throttler.storage';

describe('RedisThrottlerStorage', () => {
  it('пускает 5 попаданий и блокирует шестое в том же окне', async () => {
    let hits = 0;
    const pexpire = vi.fn(async () => 1);
    const redis = {
      incr: vi.fn(async () => {
        hits += 1;
        return hits;
      }),
      pexpire,
      pttl: vi.fn(async () => 40_000),
    };
    const storage = new RedisThrottlerStorage(redis);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const row = await storage.increment('key', 60_000, 5, 60_000, 'login');
      expect(row.isBlocked).toBe(false);
    }
    const blocked = await storage.increment('key', 60_000, 5, 60_000, 'login');
    expect(blocked.isBlocked).toBe(true);
    expect(blocked.timeToExpire).toBe(40);
    expect(pexpire).toHaveBeenCalledTimes(1);
    expect(pexpire).toHaveBeenCalledWith('auth:throttle:login:key', 60_000);
  });
});
