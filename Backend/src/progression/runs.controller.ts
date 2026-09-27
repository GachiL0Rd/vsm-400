import { Body, Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from 'nestjs-zod';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { Role } from '../generated/prisma/client';
import {
  type RunReviewBody,
  RunReviewBodySchema,
  runReviewResponseSchema,
  suspiciousRunSchema,
} from './run-review.dto';
import { RunsReviewService } from './runs-review.service';

@ApiTags('runs')
@ApiCookieAuth('vsm_access')
@Controller('runs')
export class RunsController {
  constructor(@Inject(RunsReviewService) private readonly reviews: RunsReviewService) {}

  @Get('suspicious')
  @Roles(Role.CHIEF, Role.ADMIN)
  @ApiOperation({ summary: 'Очередь подозрительных рейсов без разбора' })
  @ApiOkResponse({ schema: { type: 'array', items: suspiciousRunSchema } })
  queue(@CurrentUser() actor: AuthUser) {
    return this.reviews.queue(actor);
  }

  @Post(':id/review')
  @HttpCode(200)
  @Roles(Role.CHIEF, Role.ADMIN)
  @ApiOperation({ summary: 'Снять или оставить флаг подозрительного рейса' })
  @ApiBody({
    schema: { type: 'object', required: ['approve'], properties: { approve: { type: 'boolean' } } },
  })
  @ApiOkResponse({ schema: runReviewResponseSchema })
  review(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(RunReviewBodySchema)) body: RunReviewBody,
  ) {
    return this.reviews.review(actor, id, body.approve);
  }
}
