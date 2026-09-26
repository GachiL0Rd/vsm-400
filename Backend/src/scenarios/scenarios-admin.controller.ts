import { Body, Controller, HttpCode, Inject, Param, Post, Put } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { assertScenarioEditor } from './access';
import {
  type ScenarioDetail,
  ScenarioDetailDto,
  ScenarioStatusDto,
  ScenarioStatusPatchSchema,
  type ScenarioStatusView,
  ScenarioStatusViewDto,
} from './dto';
import { ScenariosService } from './scenarios.service';

@ApiTags('scenarios')
@ApiCookieAuth('vsm_access')
@ApiBearerAuth('bearer')
@Roles('METHODIST', 'ADMIN')
@Controller({ path: 'admin/scenarios', version: '1' })
export class ScenariosAdminController {
  constructor(@Inject(ScenariosService) private readonly scenarios: ScenariosService) {}

  @Put(':id')
  @ApiOperation({ summary: 'Сохранить граф новой версией' })
  @ApiBody({ schema: { type: 'object', additionalProperties: true } })
  @ApiOkResponse({ type: ScenarioDetailDto })
  @ApiUnauthorizedResponse({ description: 'Нет сессии' })
  @ApiForbiddenResponse({ description: 'Нужна роль методиста или администратора' })
  @ApiNotFoundResponse({ description: 'Пользователь не найден' })
  @ApiUnprocessableEntityResponse({ description: 'Граф не прошёл схему' })
  save(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ScenarioDetail> {
    assertScenarioEditor(user);
    return this.scenarios.saveGraph(id, body, user.id);
  }

  @Post(':id/status')
  @HttpCode(200)
  @ApiOperation({ summary: 'Сменить статус сценария' })
  @ApiBody({ type: ScenarioStatusDto })
  @ApiOkResponse({ type: ScenarioStatusViewDto })
  @ApiUnauthorizedResponse({ description: 'Нет сессии' })
  @ApiForbiddenResponse({ description: 'Нужна роль методиста или администратора' })
  @ApiNotFoundResponse({ description: 'Сценарий не найден' })
  @ApiUnprocessableEntityResponse({ description: 'Неизвестный статус' })
  setStatus(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ScenarioStatusView> {
    assertScenarioEditor(user);
    // Параметр стирается в import type, глобальный pipe его не видит.
    const parsed = ScenarioStatusPatchSchema.safeParse(body);
    if (!parsed.success) {
      throw parsed.error;
    }
    return this.scenarios.setStatus(id, parsed.data.status);
  }
}
