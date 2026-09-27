import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../config/env';

@Injectable()
export class RedisService extends Redis implements OnModuleInit, OnModuleDestroy {
  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super(config.redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      connectTimeout: 5_000,
      // null останавливает реконнект, чтобы старт не висел без Redis.
      retryStrategy: (times: number) => (times > 3 ? null : Math.min(times * 200, 1_000)),
    });
  }

  async onModuleInit(): Promise<void> {
    if (this.status === 'wait') {
      await this.connect();
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.status === 'wait' || this.status === 'end' || this.status === 'close') {
      return;
    }
    await this.quit();
  }
}
