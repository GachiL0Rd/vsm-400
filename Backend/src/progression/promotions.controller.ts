import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { ZodValidationPipe } from 'nestjs-zod';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { PromotionStatus, Role } from '../generated/prisma/client';
import {
  type DecisionBody,
  DecisionBodySchema,
  type PromotionListQuery,
  PromotionListQuerySchema,
  promotionResponseSchema,
} from './promotion.dto';
import { PromotionsService } from './promotions.service';

@ApiTags('promotions')
@ApiCookieAuth('vsm_access')
@Controller('promotions')
export class PromotionsController {
  constructor(@Inject(PromotionsService) private readonly promotions: PromotionsService) {}

  @Get()
  @Roles(Role.CHIEF, Role.ADMIN)
  @ApiOperation({ summary: 'Рекомендации к повышению' })
  @ApiQuery({ name: 'status', required: false, enum: ['PENDING', 'APPROVED', 'REJECTED'] })
  @ApiOkResponse({ schema: { type: 'array', items: promotionResponseSchema } })
  list(
    @CurrentUser() actor: AuthUser,
    @Query(new ZodValidationPipe(PromotionListQuerySchema)) query: PromotionListQuery,
  ) {
    const status = query.status ?? PromotionStatus.PENDING;
    return this.promotions.list(actor, status);
  }

  @Post(':id/decision')
  @HttpCode(200)
  @Roles(Role.CHIEF, Role.ADMIN)
  @ApiOperation({ summary: 'Утвердить или отклонить повышение' })
  @ApiBody({
    schema: { type: 'object', required: ['approve'], properties: { approve: { type: 'boolean' } } },
  })
  @ApiOkResponse({ schema: promotionResponseSchema })
  decide(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(DecisionBodySchema)) body: DecisionBody,
  ) {
    return this.promotions.decide(actor, id, body.approve);
  }
}
