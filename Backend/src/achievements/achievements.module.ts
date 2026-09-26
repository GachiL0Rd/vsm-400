import { Module } from '@nestjs/common';
import { ProgressionModule } from '../progression/progression.module';
import { AchievementsService } from './achievements.service';

@Module({
  imports: [ProgressionModule],
  providers: [AchievementsService],
  exports: [AchievementsService],
})
export class AchievementsModule {}
