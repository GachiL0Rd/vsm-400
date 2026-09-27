import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { PrismaPingIndicator } from './prisma-ping.indicator';
import { RedisPingIndicator } from './redis-ping.indicator';

@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [PrismaPingIndicator, RedisPingIndicator],
})
export class HealthModule {}
