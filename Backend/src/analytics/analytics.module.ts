import { Module } from '@nestjs/common';
import { AccessGuard } from '../cabinet/access.guard';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';

@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService, AccessGuard],
})
export class AnalyticsModule {}
