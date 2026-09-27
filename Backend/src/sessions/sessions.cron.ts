import { Inject, Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SessionsService } from './sessions.service';

@Injectable()
export class SessionExpiry {
  constructor(@Inject(SessionsService) private readonly sessions: SessionsService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  expire(): Promise<number> {
    return this.sessions.expireDue();
  }
}
