import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ZodValidationPipe } from 'nestjs-zod';
import type { AuthUser } from '../auth/auth-user';
import type { CookieReply } from '../auth/cookies';
import { CurrentUser } from '../auth/current-user.decorator';
import { APP_CONFIG, type AppConfig } from '../config/env';
import { ActorType } from '../generated/prisma/client';
import {
  AbortResultDto,
  DecisionDto,
  DecisionViewDto,
  OpenedSessionDto,
  OpenSessionDto,
  RevealDto,
  SessionViewDto,
} from './dto';
import { GAME_COOKIE, gameCookieOptions } from './game-cookie';
import { SessionsService } from './sessions.service';

type HttpRequest = { ip?: string };

@ApiTags('game-sessions')
@ApiCookieAuth('vsm_access')
@ApiBearerAuth('bearer')
@Controller({ path: 'game-sessions', version: '1' })
export class SessionsController {
  constructor(
    @Inject(SessionsService) private readonly sessions: SessionsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Открыть смену или вернуть уже идущую' })
  @ApiBody({ type: OpenSessionDto })
  @ApiOkResponse({ type: OpenedSessionDto })
  @ApiCreatedResponse({ description: 'Ответ 200: новая смена и повтор отдают одно и то же тело' })
  @ApiUnauthorizedResponse({ description: 'Нет сессии' })
  async open(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(OpenSessionDto)) body: OpenSessionDto,
    @Req() request: HttpRequest,
    @Res({ passthrough: true }) reply: CookieReply,
  ) {
    const opened = await this.sessions.open(user, body, readIp(request));
    reply.setCookie(GAME_COOKIE, opened.ticket, gameCookieOptions(this.config.cookieSecure));
    return opened;
  }

  @Get(':id')
  @ApiOperation({ summary: 'Текущий узел смены. Просроченный дедлайн сервер закрывает сам' })
  @ApiOkResponse({ type: SessionViewDto })
  view(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.sessions.viewSession(user.id, id);
  }

  @Post(':id/decisions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ход. Повтор того же seq и choiceId отдаёт прежний ответ' })
  @ApiBody({ type: DecisionDto })
  @ApiOkResponse({ type: DecisionViewDto })
  decide(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(DecisionDto)) body: DecisionDto,
    @Req() request: HttpRequest,
  ) {
    return this.sessions.decide({
      sessionId: id,
      seq: body.seq,
      choiceId: body.choiceId,
      clientTs: body.clientTs,
      ownerId: user.id,
      actor: { type: ActorType.USER, id: user.id, ip: readIp(request) },
    });
  }

  @Post(':id/abort')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Прервать смену. Рейс не пишется' })
  @ApiOkResponse({ type: AbortResultDto })
  abort(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() request: HttpRequest) {
    return this.sessions.abort(user.id, id, readIp(request));
  }

  @Get(':id/reveal')
  @ApiOperation({ summary: 'Раскрыть seed после завершённой смены' })
  @ApiOkResponse({ type: RevealDto })
  reveal(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.sessions.reveal(user.id, id);
  }
}

function readIp(request: HttpRequest): string | null {
  return typeof request.ip === 'string' && request.ip.length > 0 ? request.ip : null;
}
