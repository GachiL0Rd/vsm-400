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

/** Факты и строки режем, чтобы тело finish не раздувало журнал. */
const MAX_ASSESSMENT_FACTS = 500;
const MAX_DETAIL_KEYS = 24;
const MAX_SHORT = 64;
const MAX_FACT_ID = 160;
const MAX_DETAIL_TEXT = 200;
/** round(us/1000) должен влезть в int4 reactionMs. */
const MAX_SIM_US = 2_147_483_647_000;
const MAX_SCORE_DELTA = 10_000;

const simMicrosSchema = z.int().nonnegative().max(MAX_SIM_US);

const detailValueSchema = z.union([
  z.string().max(MAX_DETAIL_TEXT),
  z.number(),
  z.boolean(),
  z.null(),
]);

const detailSchema = z
  .record(z.string().min(1).max(MAX_SHORT), detailValueSchema)
  .superRefine((detail, ctx) => {
    if (Object.keys(detail).length > MAX_DETAIL_KEYS) {
      ctx.addIssue({ code: 'custom', message: 'detail слишком большой' });
    }
  });

const assessmentFactSchema = z.strictObject({
  id: z.string().min(1).max(MAX_FACT_ID),
  kind: z.string().min(1).max(MAX_SHORT),
  at: simMicrosSchema,
  verdict: z.enum(['correct', 'late', 'incorrect', 'missed']),
  scoreDelta: z.strictObject({
    safety: z.number().min(-MAX_SCORE_DELTA).max(MAX_SCORE_DELTA),
    customerSatisfaction: z.number().min(-MAX_SCORE_DELTA).max(MAX_SCORE_DELTA),
  }),
  reactionUs: simMicrosSchema.optional(),
  detail: detailSchema,
});

const finishedAssessmentSchema = z.strictObject({
  setVersion: z.string().min(1).max(MAX_SHORT),
  durationUs: simMicrosSchema,
  facts: z.array(assessmentFactSchema).max(MAX_ASSESSMENT_FACTS),
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
  assessment: finishedAssessmentSchema.optional(),
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
