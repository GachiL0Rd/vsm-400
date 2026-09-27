import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module';
import { ScenariosModule } from '../scenarios/scenarios.module';
import { InternalSessionsController } from './internal.controller';
import { PlatformController } from './platform.controller';
import { PlatformSessionService } from './platform.service';
import { SessionsController } from './sessions.controller';
import { SessionExpiry } from './sessions.cron';
import { SessionsService } from './sessions.service';
import { TicketService } from './ticket.service';

@Module({
  imports: [ScenariosModule, LlmModule],
  controllers: [SessionsController, InternalSessionsController, PlatformController],
  providers: [SessionsService, TicketService, SessionExpiry, PlatformSessionService],
})
export class SessionsModule {}
