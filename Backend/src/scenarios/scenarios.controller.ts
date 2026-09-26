import { Controller, Get, Inject, Param } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { type CatalogItem, CatalogItemDto, type ScenarioDetail, ScenarioDetailDto } from './dto';
import { ScenariosService } from './scenarios.service';

@ApiTags('scenarios')
@ApiCookieAuth('vsm_access')
@ApiBearerAuth('bearer')
@Controller({ path: 'scenarios', version: '1' })
export class ScenariosController {
  constructor(@Inject(ScenariosService) private readonly scenarios: ScenariosService) {}

  @Get()
  @ApiOperation({ summary: 'Каталог опубликованных сценариев' })
  @ApiOkResponse({ type: CatalogItemDto, isArray: true })
  @ApiUnauthorizedResponse({ description: 'Нет сессии' })
  catalog(@CurrentUser() _user: AuthUser): Promise<CatalogItem[]> {
    return this.scenarios.getCatalog();
  }

  @Get(':id')
  @Roles('METHODIST', 'ADMIN')
  @ApiOperation({ summary: 'Сценарий с графом текущей версии' })
  @ApiOkResponse({ type: ScenarioDetailDto })
  @ApiUnauthorizedResponse({ description: 'Нет сессии' })
  @ApiForbiddenResponse({ description: 'Нужна роль методиста или администратора' })
  @ApiNotFoundResponse({ description: 'Сценарий не найден' })
  scenario(@CurrentUser() _user: AuthUser, @Param('id') id: string): Promise<ScenarioDetail> {
    return this.scenarios.getById(id);
  }
}
