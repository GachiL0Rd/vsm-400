import type { ThrottlerStorage } from '@nestjs/throttler';

export type ThrottleRedis = {
  incr(key: string): Promise<number>;
  pexpire(key: string, milliseconds: number): Promise<number>;
  pttl(key: string): Promise<number>;
};

/**
 * Счётчик логина в том же Redis, что и приложение.
 * @nest-lab/throttler-storage-redis 1.2.0 тянет Nest 11, но открывает второй ioredis
 * и не закрывает его в onModuleDestroy — vitest из-за этого не завершается.
 * ttl на входе — миллисекунды (контракт ThrottlerGuard), timeToExpire — секунды.
 */
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly redis: ThrottleRedis) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    _blockDuration: number,
    throttlerName: string,
  ): Promise<Awaited<ReturnType<ThrottlerStorage['increment']>>> {
    const redisKey = `auth:throttle:${throttlerName}:${key}`;
    const hits = await this.redis.incr(redisKey);
    if (hits === 1) {
      await this.redis.pexpire(redisKey, ttl);
    }
    let leftMs = await this.redis.pttl(redisKey);
    if (leftMs < 0) {
      await this.redis.pexpire(redisKey, ttl);
      leftMs = ttl;
    }
    const timeToExpire = Math.max(1, Math.ceil(leftMs / 1000));
    const isBlocked = hits > limit;
    return {
      totalHits: hits,
      timeToExpire,
      isBlocked,
      timeToBlockExpire: isBlocked ? timeToExpire : 0,
    };
  }
}
