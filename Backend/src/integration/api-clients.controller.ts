import { Body, Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCookieAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator';
import { Role } from '../generated/prisma/client';
import { ApiClientsService } from './api-clients.service';
import { apiClientSchema, CreateApiClientDto, createdApiClientSchema, problemSchema } from './dto';

@ApiTags('admin')
@ApiCookieAuth('vsm_access')
@ApiBearerAuth('bearer')
@Roles(Role.ADMIN)
@Controller('admin/api-clients')
export class ApiClientsController {
  constructor(@Inject(ApiClientsService) private readonly clients: ApiClientsService) {}

  @Post()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Выпустить ключ API. Секрет показывается один раз' })
  @ApiBody({ type: CreateApiClientDto })
  @ApiResponse({ status: 201, schema: createdApiClientSchema })
  @ApiResponse({ status: 401, schema: problemSchema })
  @ApiResponse({ status: 403, schema: problemSchema })
  @ApiResponse({ status: 422, schema: problemSchema })
  create(@Body() body: CreateApiClientDto) {
    return this.clients.create(body);
  }

  @Get()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Список клиентов API без секретов' })
  @ApiResponse({ status: 200, schema: { type: 'array', items: apiClientSchema } })
  @ApiResponse({ status: 401, schema: problemSchema })
  list() {
    return this.clients.list();
  }

  @Post(':id/revoke')
  @HttpCode(200)
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Отозвать ключ API' })
  @ApiResponse({
    status: 200,
    schema: {
      type: 'object',
      required: ['id', 'revokedAt'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        revokedAt: { type: 'string', format: 'date-time' },
      },
    },
  })
  @ApiResponse({ status: 404, schema: problemSchema })
  revoke(@Param('id') id: string) {
    return this.clients.revoke(id);
  }
}
