import { Module } from '@nestjs/common';
import { ScenariosModule } from '../scenarios/scenarios.module';
import { InternalSessionsController } from './internal.controller';
import { SessionsController } from './sessions.controller';
import { SessionExpiry } from './sessions.cron';
import { SessionsService } from './sessions.service';
import { TicketService } from './ticket.service';

@Module({
  imports: [ScenariosModule],
  controllers: [SessionsController, InternalSessionsController],
  providers: [SessionsService, TicketService, SessionExpiry],
})
export class SessionsModule {}
