import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { APP_CONFIG, type AppConfig } from '../config/env';
import { RedisService } from '../redis/redis.service';
import { LLM_BACKOFF_MS, LLM_JOB_ATTEMPTS, LLM_PROVIDER, LLM_QUEUE } from './llm.constants';
import { LlmStatusController, LlmVariantsController } from './llm.controller';
import { LlmProcessor } from './llm.processor';
import { LlmSessionListener } from './llm-session.listener';
import { createLlmProvider } from './providers/create-provider';
import { VariantPoolService } from './variant-pool.service';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        connection: {
          url: config.redisUrl,
          maxRetriesPerRequest: null,
        },
      }),
    }),
    BullModule.registerQueue({
      name: LLM_QUEUE,
      defaultJobOptions: {
        attempts: LLM_JOB_ATTEMPTS,
        backoff: { type: 'exponential', delay: LLM_BACKOFF_MS },
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 100 },
      },
    }),
  ],
  controllers: [LlmVariantsController, LlmStatusController],
  providers: [
    LlmProcessor,
    LlmSessionListener,
    VariantPoolService,
    {
      provide: LLM_PROVIDER,
      inject: [APP_CONFIG, RedisService],
      useFactory: (config: AppConfig, redis: RedisService) => createLlmProvider(config, redis),
    },
  ],
  exports: [VariantPoolService, LLM_PROVIDER],
})
export class LlmModule {}
