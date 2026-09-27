import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;

export const PromotionListQuerySchema = z.strictObject({
  status: z.enum(STATUSES).optional(),
});

export class PromotionListQuery extends createZodDto(PromotionListQuerySchema) {}

export const DecisionBodySchema = z.strictObject({
  approve: z.boolean(),
});

export class DecisionBody extends createZodDto(DecisionBodySchema) {}

export const promotionResponseSchema = {
  type: 'object',
  required: ['id', 'userId', 'fromGrade', 'toGrade', 'reasons', 'status', 'createdAt', 'decidedAt'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    userId: { type: 'string', format: 'uuid' },
    fromGrade: {
      type: 'string',
      enum: ['TRAINEE', 'CONDUCTOR', 'CONDUCTOR_SENIOR', 'INSTRUCTOR'],
    },
    toGrade: {
      type: 'string',
      enum: ['TRAINEE', 'CONDUCTOR', 'CONDUCTOR_SENIOR', 'INSTRUCTOR'],
    },
    reasons: { type: 'array', items: { type: 'string' } },
    status: { type: 'string', enum: [...STATUSES] },
    createdAt: { type: 'string', format: 'date-time' },
    decidedAt: { type: 'string', format: 'date-time', nullable: true },
  },
};
