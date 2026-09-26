import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { ZodValidationPipe } from 'nestjs-zod';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import type { Leaderboard } from './board';
import { BrigadePlaceDto, LeaderboardDto, SeasonQueryDto } from './leaderboard.dto';
import { LeaderboardService } from './leaderboard.service';

@ApiTags('рейтинг')
@ApiCookieAuth('vsm_access')
@ApiBearerAuth('bearer')
@Controller('leaderboards')
export class LeaderboardController {
  constructor(@Inject(LeaderboardService) private readonly boards: LeaderboardService) {}

  @Get('brigades')
  @ApiOperation({ summary: 'Место бригады среди бригад депо' })
  @ApiOkResponse({ type: BrigadePlaceDto })
  place(@CurrentUser() user: AuthUser): Promise<{ rank: number | null; total: number }> {
    return this.boards.brigadePlace(user);
  }

  @Get(':scope')
  @ApiOperation({ summary: 'Рейтинг бригады, депо или компании' })
  @ApiQuery({ name: 'season', required: false, description: 'id сезона, иначе текущий' })
  @ApiOkResponse({ type: LeaderboardDto })
  board(
    @CurrentUser() user: AuthUser,
    @Param('scope') scope: string,
    @Query(new ZodValidationPipe(SeasonQueryDto)) query: SeasonQueryDto,
  ): Promise<Leaderboard> {
    return this.boards.board(user, scope, query.season);
  }
}
