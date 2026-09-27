import { Body, Controller, HttpCode, HttpStatus, Inject, Param, Post, Req } from '@nestjs/common';
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
import { CurrentUser } from '../auth/current-user.decorator';
import { AbortResultDto, OpenedSessionDto, OpenSessionDto } from './dto';
import { SessionsService } from './sessions.service';

type HttpRequest = { ip?: string };

@ApiTags('game-sessions')
@ApiCookieAuth('vsm_access')
@ApiBearerAuth('bearer')
@Controller({ path: 'game-sessions', version: '1' })
export class SessionsController {
  constructor(@Inject(SessionsService) private readonly sessions: SessionsService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Открыть смену или вернуть уже идущую' })
  @ApiBody({ type: OpenSessionDto })
  @ApiOkResponse({ type: OpenedSessionDto })
  @ApiCreatedResponse({ description: 'Ответ 200: новая смена и повтор отдают одно и то же тело' })
  @ApiUnauthorizedResponse({ description: 'Нет сессии' })
  open(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(OpenSessionDto)) body: OpenSessionDto,
    @Req() request: HttpRequest,
  ) {
    return this.sessions.open(user, body, readIp(request));
  }

  @Post(':id/abort')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Прервать смену. Рейс не пишется' })
  @ApiOkResponse({ type: AbortResultDto })
  abort(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() request: HttpRequest) {
    return this.sessions.abort(user.id, id, readIp(request));
  }
}

function readIp(request: HttpRequest): string | null {
  return typeof request.ip === 'string' && request.ip.length > 0 ? request.ip : null;
}
