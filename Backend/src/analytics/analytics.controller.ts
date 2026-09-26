import { Controller, Get, Inject, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { AccessGuard } from '../cabinet/access.guard';
import { Role } from '../generated/prisma/client';
import { AnalyticsService } from './analytics.service';
import { GapsDto, HeatmapDto, ScenarioFunnelDto } from './dto';

@ApiTags('analytics')
@ApiCookieAuth('vsm_access')
@ApiBearerAuth('bearer')
@UseGuards(AccessGuard)
@Roles(Role.CHIEF, Role.METHODIST, Role.ADMIN)
@Controller('analytics')
export class AnalyticsController {
  constructor(@Inject(AnalyticsService) private readonly analytics: AnalyticsService) {}

  @Get('brigades/:id/heatmap')
  @ApiOperation({ summary: 'Сотрудники бригады и компетенции' })
  @ZodResponse({ type: HeatmapDto, description: 'Тепловая карта' })
  heatmap(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.analytics.heatmap(user, id);
  }

  @Get('brigades/:id/gaps')
  @ApiOperation({ summary: 'Слабые зоны бригады и что назначить' })
  @ZodResponse({ type: GapsDto, description: 'Просадки, таймауты, горячие узлы' })
  gaps(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.analytics.gaps(user, id);
  }

  @Get('scenarios/:id')
  @Roles(Role.METHODIST, Role.ADMIN)
  @ApiOperation({ summary: 'Воронка сценария по узлам' })
  @ZodResponse({ type: ScenarioFunnelDto, description: 'Выборы и доля таймаутов' })
  funnel(@Param('id') id: string) {
    return this.analytics.funnel(id);
  }
}
