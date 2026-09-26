import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RulesModule } from '../rules/rules.module';
import { PromotionsController } from './promotions.controller';
import { PromotionsService } from './promotions.service';
import { RunRecorder } from './run-recorder';

@Module({
  imports: [PrismaModule, RulesModule],
  controllers: [PromotionsController],
  providers: [RunRecorder, PromotionsService],
  exports: [RunRecorder, PromotionsService],
})
export class ProgressionModule {}
