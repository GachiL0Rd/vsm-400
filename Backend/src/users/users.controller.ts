import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from 'nestjs-zod';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { clientIp } from '../auth/request';
import { Roles } from '../auth/roles.decorator';
import { Role } from '../generated/prisma/client';
import { CreateUserDto, ListUsersDto, UpdateUserDto } from './users.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiCookieAuth('vsm_access')
@ApiBearerAuth('bearer')
@Roles(Role.ADMIN)
@Controller('admin/users')
export class UsersController {
  constructor(@Inject(UsersService) private readonly users: UsersService) {}

  @Post()
  @ApiOperation({ summary: 'Создать учётку, пароль возвращается один раз' })
  @ApiBody({ type: CreateUserDto })
  create(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodValidationPipe(CreateUserDto)) body: CreateUserDto,
    @Req() request: { ip?: string },
  ) {
    return this.users.createUser(body, { id: actor.id, ip: clientIp(request) });
  }

  @Get()
  @ApiOperation({ summary: 'Список учёток' })
  list(@Query(new ZodValidationPipe(ListUsersDto)) query: ListUsersDto) {
    return this.users.list(query);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Изменить роль, бригаду или блокировку' })
  @ApiBody({ type: UpdateUserDto })
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateUserDto)) body: UpdateUserDto,
    @Req() request: { ip?: string },
  ) {
    return this.users.update(id, body, { id: actor.id, ip: clientIp(request) });
  }

  @Post(':id/reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Сбросить пароль, новый показывается один раз' })
  resetPassword(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Req() request: { ip?: string },
  ) {
    return this.users.resetPassword(id, { id: actor.id, ip: clientIp(request) });
  }
}
