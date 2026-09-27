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
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { PlatformBearer } from '../auth/platform-bearer.decorator';
import {
  type FinishedGameResult,
  FinishedGameResultDto,
  FinishResponseDto,
  finishedGameResultSchema,
  ResolveResponseDto,
  ResolveSessionDto,
  resolveSessionSchema,
} from './platform.dto';
import { PlatformSessionService } from './platform.service';
import { PlatformZodPipe } from './platform-zod.pipe';

@ApiTags('platform')
@PlatformBearer()
@Controller({ path: 'game/sessions', version: VERSION_NEUTRAL })
export class PlatformController {
  constructor(@Inject(PlatformSessionService) private readonly platform: PlatformSessionService) {}

  @Post('resolve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Разрешить билет запуска в попытку. Bearer Game Server' })
  @ApiBody({ type: ResolveSessionDto })
  @ApiOkResponse({ type: ResolveResponseDto })
  @ApiBadRequestResponse({ description: 'Тело не по схеме, код invalid-body' })
  @ApiUnauthorizedResponse({ description: 'Нет или неверный Bearer, код INVALID_PLATFORM_TOKEN' })
  @ApiNotFoundResponse({ description: 'Билет недействителен, код invalid-session' })
  @ApiConflictResponse({ description: 'Смена недоступна для запуска, код session-unavailable' })
  @ApiResponse({
    status: 410,
    description: 'Билет истёк (session-expired) или уже погашен (session-consumed)',
  })
  resolve(@Body(new PlatformZodPipe(resolveSessionSchema)) body: { key: string }) {
    return this.platform.resolve(body.key);
  }

  @Post(':attemptId/finish')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Принять итог попытки. Повтор того же тела отдаёт тот же resultId' })
  @ApiBody({ type: FinishedGameResultDto })
  @ApiOkResponse({ type: FinishResponseDto })
  @ApiBadRequestResponse({ description: 'Тело не по схеме или attemptId пути не совпал с телом' })
  @ApiUnauthorizedResponse({ description: 'Нет или неверный Bearer, код INVALID_PLATFORM_TOKEN' })
  @ApiNotFoundResponse({ description: 'Попытки нет, транспорт REST или смена не ACTIVE' })
  @ApiConflictResponse({ description: 'Уже сохранён другой итог, код result-conflict' })
  finish(
    @Param('attemptId') attemptId: string,
    @Body(new PlatformZodPipe(finishedGameResultSchema)) body: FinishedGameResult,
  ) {
    return this.platform.finish(attemptId, body);
  }
}
