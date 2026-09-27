import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const resolveSessionSchema = z.strictObject({
  key: z.string().min(1),
});

export class ResolveSessionDto extends createZodDto(resolveSessionSchema) {}
export type ResolveSession = z.infer<typeof resolveSessionSchema>;

const finishedContentSchema = z.strictObject({
  gameLevelId: z.string().min(1),
  gameLevelVersion: z.string().min(1),
  simulationCompatibilityVersion: z.string().min(1),
});

const achievementIdsSchema = z.array(z.string().min(1)).superRefine((ids, ctx) => {
  if (new Set(ids).size !== ids.length) {
    ctx.addIssue({ code: 'custom', message: 'ids повторяются' });
  }
});

export const finishedGameResultSchema = z.strictObject({
  attemptId: z.string().min(1),
  content: finishedContentSchema,
  rootSeed: z.string().min(1),
  userInputs: z.array(z.unknown()),
  achievements: z.strictObject({
    setVersion: z.string().min(1),
    ids: achievementIdsSchema,
  }),
  termination: z.strictObject({
    kind: z.enum(['route-completed', 'terminal-rule']),
    outcomeId: z.string().min(1),
  }),
  scores: z.strictObject({
    safety: z.number().min(0).max(100),
    customerSatisfaction: z.number().min(0).max(100),
  }),
});

export class FinishedGameResultDto extends createZodDto(finishedGameResultSchema) {}
export type FinishedGameResult = z.infer<typeof finishedGameResultSchema>;

export const resolveResponseSchema = z.strictObject({
  contractVersion: z.literal(1),
  attemptId: z.string().min(1),
  gameLevelId: z.string().min(1),
  mode: z.strictObject({
    kind: z.literal('live'),
  }),
});

export class ResolveResponseDto extends createZodDto(resolveResponseSchema) {}
export type ResolveResponse = z.infer<typeof resolveResponseSchema>;

export const finishResponseSchema = z.strictObject({
  contractVersion: z.literal(1),
  resultId: z.string().min(1),
  redirectUrl: z.url(),
});

export class FinishResponseDto extends createZodDto(finishResponseSchema) {}
export type FinishReceipt = z.infer<typeof finishResponseSchema>;
