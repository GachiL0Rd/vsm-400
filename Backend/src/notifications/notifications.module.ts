import { Module } from '@nestjs/common';
import { NotificationListener } from './notification.listener';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { PointsExpiryService } from './points-expiry.service';

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationListener, PointsExpiryService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
