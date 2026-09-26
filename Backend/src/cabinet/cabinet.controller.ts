import { Controller, Get, Inject, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodResponse, ZodValidationPipe } from 'nestjs-zod';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { AccessGuard } from './access.guard';
import { CabinetService } from './cabinet.service';
import {
  AchievementDto,
  CompareDto,
  NextShiftDto,
  ProfileDto,
  RunDetailDto,
  RunListDto,
  RunListQueryDto,
  StatsDto,
} from './dto';

@ApiTags('cabinet')
@ApiCookieAuth('vsm_access')
@ApiBearerAuth('bearer')
@UseGuards(AccessGuard)
@Controller('me')
export class CabinetController {
  constructor(@Inject(CabinetService) private readonly cabinet: CabinetService) {}

  @Get()
  @ApiOperation({ summary: 'Профиль текущего сотрудника' })
  @ZodResponse({ type: ProfileDto, description: 'Профиль, баллы и компетенции' })
  profile(@CurrentUser() user: AuthUser) {
    return this.cabinet.profile(user.id);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Сводка рейсов' })
  @ZodResponse({ type: StatsDto, description: 'Статистика экрана профиля' })
  stats(@CurrentUser() user: AuthUser) {
    return this.cabinet.stats(user.id);
  }

  @Get('next-shift')
  @ApiOperation({ summary: 'Ближайшая смена или прогноз' })
  @ZodResponse({ type: NextShiftDto, description: 'Смена' })
  nextShift(@CurrentUser() user: AuthUser) {
    return this.cabinet.nextShift(user.id);
  }

  @Get('runs')
  @ApiOperation({ summary: 'Журнал рейсов' })
  @ZodResponse({ type: RunListDto, description: 'Страница журнала и общее число рейсов' })
  runs(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(RunListQueryDto)) query: RunListQueryDto,
  ) {
    return this.cabinet.runs(user.id, query.limit, query.cursor);
  }

  @Get('runs/:id')
  @ApiOperation({ summary: 'Разбор рейса' })
  @ZodResponse({ type: RunDetailDto, description: 'Рейс с решениями' })
  run(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.cabinet.run(user.id, id);
  }

  @Get('achievements')
  @ApiOperation({ summary: 'Знаки отличия' })
  @ZodResponse({ status: 200, type: [AchievementDto], description: 'Каталог знаков сотрудника' })
  achievements(@CurrentUser() user: AuthUser) {
    return this.cabinet.achievements(user.id);
  }

  @Get('compare')
  @ApiOperation({ summary: 'Я, среднее бригады и депо' })
  @ZodResponse({ type: CompareDto, description: 'Сравнение за 30 дней' })
  compare(@CurrentUser() user: AuthUser) {
    return this.cabinet.compare(user.id);
  }
}
