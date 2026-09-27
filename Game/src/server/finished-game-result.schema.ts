import { z } from 'zod';

const simUsSchema = z.number().int().nonnegative().refine(Number.isSafeInteger);

const detailValueSchema = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);

const assessmentFactSchema = z.strictObject({
  id: z.string().min(1),
  kind: z.enum([
    'journal-submission',
    'boarding-decision',
    'service-request',
    'fire',
    'pressure',
    'emergency-brake',
  ]),
  at: simUsSchema,
  verdict: z.enum(['correct', 'late', 'incorrect', 'missed']),
  scoreDelta: z.strictObject({
    safety: z.number().finite(),
    customerSatisfaction: z.number().finite(),
  }),
  reactionUs: simUsSchema.optional(),
  detail: z.record(z.string().min(1), detailValueSchema),
});

export const finishedAssessmentSchema = z.strictObject({
  setVersion: z.string().min(1),
  durationUs: simUsSchema,
  facts: z.array(assessmentFactSchema),
});

export const finishedGameResultSchema = z.strictObject({
  attemptId: z.string().min(1),
  content: z.strictObject({
    gameLevelId: z.string().min(1),
    gameLevelVersion: z.string().min(1),
    simulationCompatibilityVersion: z.string().min(1),
  }),
  rootSeed: z.string().min(1),
  userInputs: z.array(z.unknown()),
  achievements: z.strictObject({
    setVersion: z.string().min(1),
    ids: z.array(z.string().min(1)),
  }),
  termination: z.strictObject({
    kind: z.enum(['route-completed', 'terminal-rule']),
    outcomeId: z.string().min(1),
  }),
  scores: z.strictObject({
    safety: z.number().finite().min(0).max(100),
    customerSatisfaction: z.number().finite().min(0).max(100),
  }),
  assessment: finishedAssessmentSchema.optional(),
});
