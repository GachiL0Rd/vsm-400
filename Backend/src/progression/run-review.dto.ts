import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const RunReviewBodySchema = z.strictObject({
  approve: z.boolean(),
});

export class RunReviewBody extends createZodDto(RunReviewBodySchema) {}

export const runReviewResponseSchema = {
  type: 'object',
  required: [
    'id',
    'userId',
    'suspicious',
    'points',
    'reviewApproved',
    'reviewedAt',
    'reviewedById',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    userId: { type: 'string', format: 'uuid' },
    suspicious: { type: 'boolean' },
    points: { type: 'integer' },
    reviewApproved: { type: 'boolean' },
    reviewedAt: { type: 'string', format: 'date-time' },
    reviewedById: { type: 'string', format: 'uuid' },
  },
};

export const suspiciousRunSchema = {
  type: 'object',
  required: [
    'id',
    'userId',
    'callsign',
    'brigadeId',
    'train',
    'route',
    'outcome',
    'points',
    'finishedAt',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    userId: { type: 'string', format: 'uuid' },
    callsign: { type: 'string' },
    brigadeId: { type: 'string', format: 'uuid', nullable: true },
    train: { type: 'string' },
    route: { type: 'string' },
    outcome: { type: 'string', enum: ['completed', 'incident', 'terminated'] },
    points: { type: 'integer' },
    finishedAt: { type: 'string', format: 'date-time' },
  },
};
