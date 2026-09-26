import { Module } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ZodValidationPipe } from 'nestjs-zod';
import { ProblemFilter } from './common/problem.filter';
import { ConfigModule } from './config/config.module';
import { HealthModule } from './health/health.module';
import { IntegrationModule } from './integration/integration.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { RulesModule } from './rules/rules.module';

@Module({
  imports: [
    ConfigModule,
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    PrismaModule,
    RedisModule,
    RulesModule,
    HealthModule,
    IntegrationModule,
  ],
  providers: [
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_FILTER, useClass: ProblemFilter },
  ],
})
export class AppModule {}
