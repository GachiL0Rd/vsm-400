import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RulesModule } from '../rules/rules.module';
import { PromotionsController } from './promotions.controller';
import { PromotionsService } from './promotions.service';
import { RunRecorder } from './run-recorder';
import { RunsController } from './runs.controller';
import { RunsReviewService } from './runs-review.service';

@Module({
  imports: [PrismaModule, RulesModule],
  controllers: [PromotionsController, RunsController],
  providers: [RunRecorder, PromotionsService, RunsReviewService],
  exports: [RunRecorder, PromotionsService],
})
export class ProgressionModule {}
