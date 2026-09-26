import { Controller, Get, Inject, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { OrgService } from './org.service';

@ApiTags('org')
@ApiCookieAuth('vsm_access')
@ApiBearerAuth('bearer')
@Controller('org')
export class OrgController {
  constructor(@Inject(OrgService) private readonly org: OrgService) {}

  @Get('depots')
  @ApiOperation({ summary: 'Депо' })
  depots(@CurrentUser() user: AuthUser) {
    return this.org.listDepots(user);
  }

  @Get('depots/:id/brigades')
  @ApiOperation({ summary: 'Бригады депо' })
  brigades(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.org.listBrigades(id, user);
  }

  @Get('brigades/:id')
  @ApiOperation({ summary: 'Состав бригады' })
  brigade(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.org.getBrigade(id, user);
  }
}
