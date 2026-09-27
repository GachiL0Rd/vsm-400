import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from 'nestjs-zod';
import { Roles } from '../auth/roles.decorator';
import { Role } from '../generated/prisma/client';
import { AuditQueryDto } from './audit.dto';
import { AuditService } from './audit.service';

@ApiTags('audit')
@ApiCookieAuth('vsm_access')
@ApiBearerAuth('bearer')
@Roles(Role.ADMIN)
@Controller('admin/audit')
export class AuditController {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  @Get()
  @ApiOperation({ summary: 'Журнал аудита' })
  list(@Query(new ZodValidationPipe(AuditQueryDto)) query: AuditQueryDto) {
    return this.audit.list(query.page, query.limit);
  }
}
