import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { ApiClientAuth } from './api-client-auth.decorator';
import type { ApiClientContext } from './api-key.guard';
import { CurrentApiClient } from './current-api-client.decorator';
import {
  CreateWebhookDto,
  orgSchema,
  parseExtId,
  problemSchema,
  progressSchema,
  UpsertEmployeeDto,
  upsertEmployeeResponseSchema,
  webhookSchema,
} from './dto';
import { EmployeesService } from './employees.service';
import { OrgService } from './org.service';
import { WebhooksService } from './webhooks.service';

@ApiTags('integration')
@ApiSecurity('api-key')
@Controller({ path: 'integration/v1', version: VERSION_NEUTRAL })
export class IntegrationController {
  constructor(
    @Inject(EmployeesService) private readonly employees: EmployeesService,
    @Inject(OrgService) private readonly org: OrgService,
    @Inject(WebhooksService) private readonly webhooks: WebhooksService,
  ) {}

  @Put('employees/:extId')
  @ApiClientAuth('employees:write')
  @ApiOperation({ summary: 'Создать или обновить сотрудника по внешнему табельному номеру' })
  @ApiParam({ name: 'extId', description: 'Табельный номер HR. В базе хранится только HMAC' })
  @ApiBody({ type: UpsertEmployeeDto })
  @ApiResponse({ status: 200, schema: upsertEmployeeResponseSchema })
  @ApiResponse({ status: 401, schema: problemSchema })
  @ApiResponse({ status: 403, schema: problemSchema })
  @ApiResponse({ status: 404, schema: problemSchema })
  @ApiResponse({ status: 422, schema: problemSchema })
  upsert(@Param('extId') extId: string, @Body() body: UpsertEmployeeDto) {
    return this.employees.upsert(parseExtId(extId), body);
  }

  @Get('employees/:extId/progress')
  @ApiClientAuth('progress:read')
  @ApiOperation({ summary: 'Прогресс сотрудника для LMS' })
  @ApiParam({ name: 'extId', description: 'Тот же табельный номер, что в PUT' })
  @ApiResponse({ status: 200, schema: progressSchema })
  @ApiResponse({ status: 401, schema: problemSchema })
  @ApiResponse({ status: 404, schema: problemSchema })
  progress(@Param('extId') extId: string) {
    return this.employees.progress(parseExtId(extId));
  }

  @Get('org')
  @ApiClientAuth('org:read')
  @ApiOperation({ summary: 'Депо, бригады и число активных сотрудников' })
  @ApiResponse({ status: 200, schema: orgSchema })
  @ApiResponse({ status: 401, schema: problemSchema })
  structure() {
    return this.org.tree();
  }

  @Post('webhooks')
  @ApiClientAuth('webhooks:manage')
  @ApiOperation({ summary: 'Подписка на события. Секрет показывается один раз' })
  @ApiBody({ type: CreateWebhookDto })
  @ApiResponse({ status: 201, schema: webhookSchema })
  @ApiResponse({ status: 401, schema: problemSchema })
  @ApiResponse({ status: 422, schema: problemSchema })
  createWebhook(@CurrentApiClient() client: ApiClientContext, @Body() body: CreateWebhookDto) {
    return this.webhooks.create(client.id, body);
  }

  @Get('webhooks')
  @ApiClientAuth('webhooks:manage')
  @ApiOperation({ summary: 'Подписки клиента без секрета' })
  @ApiResponse({ status: 200, schema: { type: 'array', items: webhookSchema } })
  listWebhooks(@CurrentApiClient() client: ApiClientContext) {
    return this.webhooks.list(client.id);
  }

  @Delete('webhooks/:id')
  @HttpCode(204)
  @ApiClientAuth('webhooks:manage')
  @ApiOperation({ summary: 'Удалить подписку' })
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 404, schema: problemSchema })
  removeWebhook(@CurrentApiClient() client: ApiClientContext, @Param('id') id: string) {
    return this.webhooks.remove(client.id, id);
  }
}
