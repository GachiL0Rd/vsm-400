import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { CompetencySchema, EndOutcomeSchema, StageSchema, VerdictSchema } from '../engine/schema';

const limitField = z.preprocess(
  (value) => (value === undefined || value === '' ? undefined : value),
  z.coerce.number().int().min(1).max(50).default(20),
);

const optionalText = z.preprocess(
  (value) => (value === undefined || value === '' ? undefined : value),
  z.string().min(1).optional(),
);

export const RunListQuerySchema = z.object({
  limit: limitField,
  cursor: optionalText,
});

export class RunListQueryDto extends createZodDto(RunListQuerySchema) {}

const CompetenciesSchema = z.object({
  safety: z.number().int(),
  procedure: z.number().int(),
  detection: z.number().int(),
  reaction: z.number().int(),
  service: z.number().int(),
  escalation: z.number().int(),
});

const CompetencyDeltaSchema = z.object({
  safety: z.number().optional(),
  procedure: z.number().optional(),
  detection: z.number().optional(),
  reaction: z.number().optional(),
  service: z.number().optional(),
  escalation: z.number().optional(),
});

const WeakNoteSchema = z.object({
  safety: z.string().optional(),
  procedure: z.string().optional(),
  detection: z.string().optional(),
  reaction: z.string().optional(),
  service: z.string().optional(),
  escalation: z.string().optional(),
});

const FactsSchema = z.object({
  prevented: z.number().int(),
  incidents: z.number().int(),
  complaints: z.number().int(),
  interventions: z.number().int(),
});

const GradeSchema = z.enum(['TRAINEE', 'CONDUCTOR', 'CONDUCTOR_SENIOR', 'INSTRUCTOR']);

export const ProfileSchema = z
  .object({
    callsign: z.string(),
    position: z.string(),
    brigade: z.string(),
    depot: z.string(),
    level: z.number().int(),
    points: z.number().int(),
    levelFrom: z.number().int(),
    levelTo: z.number().int(),
    streakDays: z.number().int(),
    expiring: z
      .object({
        points: z.number().int(),
        at: z.string(),
      })
      .nullable(),
    competencies: CompetenciesSchema,
    trend: CompetenciesSchema,
    weakNote: WeakNoteSchema,
    grade: GradeSchema,
  })
  .meta({ id: 'Profile' });

export class ProfileDto extends createZodDto(ProfileSchema) {}

export const StatsSchema = z
  .object({
    runs: z.number().int(),
    completed: z.number().int(),
    incidents: z.number().int(),
    terminated: z.number().int(),
    defectsFound: z.number().int(),
    missedChecks: z.number().int(),
    avgReactionSec: z.number(),
    escalationsCorrect: z.number().int(),
    escalationsTotal: z.number().int(),
    luckyViolations: z.number().int(),
  })
  .meta({ id: 'Stats' });

export class StatsDto extends createZodDto(StatsSchema) {}

export const NextShiftSchema = z
  .object({
    train: z.string(),
    from: z.string(),
    fromGenitive: z.string(),
    to: z.string(),
    car: z.number().int(),
    carClass: z.string(),
    departure: z.string(),
    stops: z.array(z.string()),
    focus: z.array(CompetencySchema),
  })
  .meta({ id: 'NextShift' });

export class NextShiftDto extends createZodDto(NextShiftSchema) {}

export const RunBriefSchema = z.object({
  id: z.uuid(),
  train: z.string(),
  route: z.string(),
  car: z.number().int(),
  carClass: z.string(),
  finishedAt: z.string(),
  playMinutes: z.number().int(),
  outcome: EndOutcomeSchema,
  outcomeNote: z.string(),
  loyalty: z.number().int(),
  safety: z.number().int(),
  points: z.number().int(),
  competencyDelta: CompetencyDeltaSchema,
  facts: FactsSchema,
});

export const RunListSchema = z
  .object({
    total: z.number().int(),
    runs: z.array(RunBriefSchema),
    nextCursor: z.string().nullable(),
  })
  .meta({ id: 'RunList' });

export class RunListDto extends createZodDto(RunListSchema) {}

export const DecisionSchema = z.object({
  id: z.uuid(),
  time: z.string(),
  stage: StageSchema,
  situation: z.string(),
  action: z.string(),
  verdict: VerdictSchema,
  loyalty: z.number().int(),
  safety: z.number().int(),
  reactionSec: z.number().optional(),
  consequence: z.string().optional(),
  lucky: z.literal(true).optional(),
  better: z.string().optional(),
  basis: z.string().optional(),
});

export const RunDetailSchema = RunBriefSchema.extend({
  decisions: z.array(DecisionSchema),
}).meta({ id: 'Run' });

export class RunDetailDto extends createZodDto(RunDetailSchema) {}

export const AchievementSchema = z
  .object({
    code: z.string(),
    title: z.string(),
    description: z.string(),
    earnedAt: z.string().nullable(),
    progress: z
      .object({
        value: z.number().int(),
        total: z.number().int(),
      })
      .optional(),
  })
  .meta({ id: 'Achievement' });

export class AchievementDto extends createZodDto(AchievementSchema) {}

const ScalesSchema = z.object({
  competencies: CompetenciesSchema,
  loyalty: z.number().int().nullable(),
  safety: z.number().int().nullable(),
  politeness: z.number().int().nullable(),
});

export const CompareSchema = z
  .object({
    days: z.literal(30),
    me: ScalesSchema.extend({
      brigadeRank: z.number().int().nullable(),
      brigadeSize: z.number().int(),
    }),
    brigade: ScalesSchema.nullable(),
    depot: ScalesSchema.nullable(),
  })
  .meta({ id: 'Compare' });

export class CompareDto extends createZodDto(CompareSchema) {}

export type ProfileResponse = z.infer<typeof ProfileSchema>;
export type StatsResponse = z.infer<typeof StatsSchema>;
export type NextShiftResponse = z.infer<typeof NextShiftSchema>;
export type RunListResponse = z.infer<typeof RunListSchema>;
export type RunDetailResponse = z.infer<typeof RunDetailSchema>;
export type AchievementResponse = z.infer<typeof AchievementSchema>;
export type CompareResponse = z.infer<typeof CompareSchema>;
