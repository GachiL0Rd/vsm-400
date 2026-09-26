import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from 'nestjs-zod';
import { InternalService } from '../auth/internal-service.decorator';
import { ActorType } from '../generated/prisma/client';
import {
  DecisionDto,
  DecisionViewDto,
  EventsDto,
  EventsResultDto,
  ReportResultDto,
  RunReportDto,
  VerifyResultDto,
  VerifyTicketDto,
} from './dto';
import { SessionsService } from './sessions.service';

@ApiTags('internal')
@InternalService()
@Controller({ path: 'internal/v1', version: VERSION_NEUTRAL })
export class InternalSessionsController {
  constructor(@Inject(SessionsService) private readonly sessions: SessionsService) {}

  @Post('tickets/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Проверить и погасить игровой билет' })
  @ApiBody({ type: VerifyTicketDto })
  @ApiOkResponse({ type: VerifyResultDto })
  verify(@Body(new ZodValidationPipe(VerifyTicketDto)) body: VerifyTicketDto) {
    return this.sessions.verifyTicket(body.ticket);
  }

  @Post('game-sessions/:id/decisions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ход от GameServer. Тот же движок, что у REST' })
  @ApiBody({ type: DecisionDto })
  @ApiOkResponse({ type: DecisionViewDto })
  decide(@Param('id') id: string, @Body(new ZodValidationPipe(DecisionDto)) body: DecisionDto) {
    return this.sessions.decide({
      sessionId: id,
      seq: body.seq,
      choiceId: body.choiceId,
      clientTs: body.clientTs,
      ownerId: null,
      actor: { type: ActorType.GAME_SERVER, id: null, ip: null },
    });
  }

  @Post('game-sessions/:id/events')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Пакет телеметрии. Повтор seq не создаёт вторую строку' })
  @ApiBody({ type: EventsDto })
  @ApiOkResponse({ type: EventsResultDto })
  events(@Param('id') id: string, @Body(new ZodValidationPipe(EventsDto)) body: EventsDto) {
    return this.sessions.acceptEvents(id, body);
  }

  @Post('game-sessions/:id/report')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Отчёт симуляции. Повтор отдаёт тот же runId' })
  @ApiBody({ type: RunReportDto })
  @ApiOkResponse({ type: ReportResultDto })
  report(@Param('id') id: string, @Body(new ZodValidationPipe(RunReportDto)) body: RunReportDto) {
    return this.sessions.acceptReport(id, body);
  }
}
