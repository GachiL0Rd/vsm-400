import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodResponse, ZodValidationPipe } from 'nestjs-zod';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { AccessGuard } from '../cabinet/access.guard';
import { Role } from '../generated/prisma/client';
import { AssignmentsService } from './assignments.service';
import { AssignmentDto, AssignmentListDto, AssignmentQueryDto, CreateAssignmentsDto } from './dto';

@ApiTags('assignments')
@ApiCookieAuth('vsm_access')
@ApiBearerAuth('bearer')
@UseGuards(AccessGuard)
@Roles(Role.CHIEF, Role.METHODIST, Role.ADMIN)
@Controller('assignments')
export class AssignmentsController {
  constructor(@Inject(AssignmentsService) private readonly assignments: AssignmentsService) {}

  @Post()
  @ApiOperation({ summary: 'Новая смена' })
  @ZodResponse({ status: 201, type: AssignmentListDto, description: 'Созданные смены' })
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateAssignmentsDto)) body: CreateAssignmentsDto,
  ) {
    return this.assignments.create(user, body);
  }

  @Get()
  @ApiOperation({ summary: 'Назначения бригады' })
  @ZodResponse({ type: AssignmentListDto, description: 'Смены, кроме отменённых' })
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(AssignmentQueryDto)) query: AssignmentQueryDto,
  ) {
    return this.assignments.list(user, query.brigadeId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Отменить назначение' })
  @ZodResponse({ type: AssignmentDto, description: 'Назначение в статусе CANCELLED' })
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.assignments.cancel(user, id);
  }
}
