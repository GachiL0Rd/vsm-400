import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { CarClassSchema } from '../engine/schema';

export const openSessionSchema = z.strictObject({
  transport: z.literal('WS').optional().default('WS'),
  carClass: CarClassSchema.optional(),
});

export class OpenSessionDto extends createZodDto(openSessionSchema) {}

const publicPlanSchema = z.strictObject({
  train: z.string(),
  route: z.string(),
  car: z.number().int(),
  carClass: CarClassSchema,
  departure: z.string(),
  segments: z.number().int().nonnegative(),
  titles: z.array(z.string()),
});

export const openedSessionSchema = z.strictObject({
  sessionId: z.uuid(),
  ticket: z.string().min(1),
  wsUrl: z.string().min(1),
  launchUrl: z.string().min(1).describe('Абсолютный URL клиента Game с query sessionKey'),
  seedCommit: z.string().regex(/^[0-9a-f]{64}$/),
  plan: publicPlanSchema,
});

export class OpenedSessionDto extends createZodDto(openedSessionSchema) {}

export const abortResultSchema = z.strictObject({
  status: z.literal('ABORTED'),
});

export class AbortResultDto extends createZodDto(abortResultSchema) {}

export type OpenedSession = z.infer<typeof openedSessionSchema>;
export type PublicPlan = z.infer<typeof publicPlanSchema>;
