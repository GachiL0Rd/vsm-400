import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import {
  GenerateResultDto,
  GenerateVariantsDto,
  GenerateVariantsSchema,
  LlmStatusDto,
  RejectVariantDto,
  RejectVariantSchema,
  VariantListDto,
  VariantListQuerySchema,
  VariantViewDto,
} from './dto';
import { VariantPoolService } from './variant-pool.service';

@ApiTags('llm')
@ApiCookieAuth('vsm_access')
@ApiBearerAuth('bearer')
@Roles('METHODIST', 'ADMIN')
@Controller({ path: 'admin/scenarios', version: '1' })
export class LlmVariantsController {
  constructor(@Inject(VariantPoolService) private readonly pool: VariantPoolService) {}

  @Get(':id/variants')
  @ApiOperation({ summary: 'Список перефразов сценария' })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['PENDING_REVIEW', 'APPROVED', 'REJECTED', 'RETIRED'],
  })
  @ApiQuery({ name: 'nodeId', required: false })
  @ApiOkResponse({ type: VariantListDto })
  @ApiUnauthorizedResponse({ description: 'Нет сессии' })
  @ApiForbiddenResponse({ description: 'Нужна роль методиста или администратора' })
  @ApiNotFoundResponse({ description: 'Сценарий не найден' })
  @ApiUnprocessableEntityResponse({ description: 'Неизвестный фильтр' })
  async list(
    @Param('id') id: string,
    @Query('status') status?: string,
    @Query('nodeId') nodeId?: string,
  ): Promise<VariantListDto> {
    const parsed = VariantListQuerySchema.safeParse({ status, nodeId });
    if (!parsed.success) {
      throw parsed.error;
    }
    const items = await this.pool.list(id, parsed.data.status, parsed.data.nodeId);
    return { items };
  }

  @Post(':id/variants/:variantId/approve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Одобрить перефраз' })
  @ApiOkResponse({ type: VariantViewDto })
  @ApiUnauthorizedResponse({ description: 'Нет сессии' })
  @ApiForbiddenResponse({ description: 'Нужна роль методиста или администратора' })
  @ApiNotFoundResponse({ description: 'Вариант не найден' })
  @ApiConflictResponse({ description: 'Вариант уже разобран' })
  approve(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('variantId') variantId: string,
  ): Promise<VariantViewDto> {
    return this.pool.approve(id, variantId, user.id);
  }

  @Post(':id/variants/:variantId/reject')
  @HttpCode(200)
  @ApiOperation({ summary: 'Отклонить перефраз' })
  @ApiBody({ type: RejectVariantDto })
  @ApiOkResponse({ type: VariantViewDto })
  @ApiUnauthorizedResponse({ description: 'Нет сессии' })
  @ApiForbiddenResponse({ description: 'Нужна роль методиста или администратора' })
  @ApiNotFoundResponse({ description: 'Вариант не найден' })
  @ApiConflictResponse({ description: 'Вариант уже разобран' })
  @ApiUnprocessableEntityResponse({ description: 'Нет причины' })
  reject(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('variantId') variantId: string,
    @Body() body: unknown,
  ): Promise<VariantViewDto> {
    const parsed = RejectVariantSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw parsed.error;
    }
    return this.pool.reject(id, variantId, user.id, parsed.data.reason);
  }

  @Post(':id/variants/generate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Поставить генерацию перефразов в очередь' })
  @ApiBody({ type: GenerateVariantsDto })
  @ApiOkResponse({ type: GenerateResultDto })
  @ApiUnauthorizedResponse({ description: 'Нет сессии' })
  @ApiForbiddenResponse({ description: 'Нужна роль методиста или администратора' })
  @ApiNotFoundResponse({ description: 'Сценарий или узел не найден' })
  @ApiConflictResponse({ description: 'LLM выключен' })
  @ApiUnprocessableEntityResponse({ description: 'count больше 20' })
  generate(@Param('id') id: string, @Body() body: unknown): Promise<GenerateResultDto> {
    const parsed = GenerateVariantsSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw parsed.error;
    }
    return this.pool.generate(id, parsed.data.nodeId, parsed.data.count ?? 1).then((enqueued) => ({
      enqueued,
    }));
  }
}

@ApiTags('llm')
@ApiCookieAuth('vsm_access')
@ApiBearerAuth('bearer')
@Roles('METHODIST', 'ADMIN')
@Controller({ path: 'admin/llm', version: '1' })
export class LlmStatusController {
  constructor(@Inject(VariantPoolService) private readonly pool: VariantPoolService) {}

  @Get('status')
  @ApiOperation({ summary: 'Провайдер, очередь и пул перефразов' })
  @ApiOkResponse({ type: LlmStatusDto })
  @ApiUnauthorizedResponse({ description: 'Нет сессии' })
  @ApiForbiddenResponse({ description: 'Нужна роль методиста или администратора' })
  status(): Promise<LlmStatusDto> {
    return this.pool.status();
  }
}
