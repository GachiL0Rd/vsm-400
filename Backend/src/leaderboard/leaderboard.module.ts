import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { LeaderboardController } from './leaderboard.controller';
import { LeaderboardService } from './leaderboard.service';
import { SeasonsService } from './seasons.service';

@Module({
  imports: [NotificationsModule],
  controllers: [LeaderboardController],
  providers: [SeasonsService, LeaderboardService],
  exports: [SeasonsService, LeaderboardService],
})
export class LeaderboardModule {}
