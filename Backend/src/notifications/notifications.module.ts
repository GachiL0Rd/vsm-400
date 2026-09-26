import { Module } from '@nestjs/common';
import { AdviceService } from './advice.service';
import { NotificationListener } from './notification.listener';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { PointsExpiryService } from './points-expiry.service';

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationListener, PointsExpiryService, AdviceService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
