import { Inject, Injectable } from '@nestjs/common';
import { HealthCheckError, HealthIndicator, type HealthIndicatorResult } from '@nestjs/terminus';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class RedisPingIndicator extends HealthIndicator {
  constructor(@Inject(RedisService) private readonly redis: RedisService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      const pong = await this.redis.ping();
      if (pong !== 'PONG') {
        throw new Error('redis');
      }
      return this.getStatus(key, true);
    } catch {
      throw new HealthCheckError('redis', this.getStatus(key, false));
    }
  }
}
