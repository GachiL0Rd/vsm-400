import { z } from 'zod';
import { ScenarioCategorySchema } from '../engine/schema';
import { Grade } from '../generated/prisma/client';

const LEVEL_COUNT = 15;

const GRADE_NAMES = [
  Grade.TRAINEE,
  Grade.CONDUCTOR,
  Grade.CONDUCTOR_SENIOR,
  Grade.INSTRUCTOR,
] as const;

const GRADE_CHAIN = [
  [Grade.TRAINEE, Grade.CONDUCTOR],
  [Grade.CONDUCTOR, Grade.CONDUCTOR_SENIOR],
  [Grade.CONDUCTOR_SENIOR, Grade.INSTRUCTOR],
] as const;

const GradeNameSchema = z.enum(GRADE_NAMES);

export const ScoringSchema = z.strictObject({
  difficultyMult: z
    .strictObject({
      '1': z.number().positive(),
      '2': z.number().positive(),
      '3': z.number().positive(),
    })
    .transform((value) => ({ 1: value['1'], 2: value['2'], 3: value['3'] })),
  /** Потолок. Фактический бонус = speedBonusMax × доля неиспользованного таймера. */
  speedBonusMax: z.number().nonnegative(),
  timeoutPenalty: z.number().nonnegative(),
  failPoints: z.number().nonnegative(),
});

const LevelSchema = z.strictObject({
  level: z.number().int(),
  from: z.number().int().nonnegative(),
  to: z.number().int().positive(),
});

type LevelDraft = z.infer<typeof LevelSchema>;

type IssueSink = {
  addIssue: (message: string) => void;
};

function checkLevelBand(levels: LevelDraft[], index: number, ctx: IssueSink): void {
  const band = levels[index];
  if (!band) {
    return;
  }
  if (band.level !== index + 1) {
    ctx.addIssue(`позиция ${index} должна быть уровнем ${index + 1}`);
  }
  if (band.to <= band.from) {
    ctx.addIssue(`уровень ${band.level}: to должен быть больше from`);
  }
  if (index === 0 && band.from !== 0) {
    ctx.addIssue('уровень 1 начинается с 0');
  }
  const previous = levels[index - 1];
  if (previous && band.from !== previous.to) {
    ctx.addIssue(`уровень ${band.level} должен начинаться с ${previous.to}`);
  }
}

const LevelsSchema = z.array(LevelSchema).superRefine((levels, ctx) => {
  if (levels.length !== LEVEL_COUNT) {
    ctx.addIssue(`нужно ровно ${LEVEL_COUNT} уровней`);
    return;
  }
  for (let index = 0; index < levels.length; index += 1) {
    checkLevelBand(levels, index, ctx);
  }
});

const GradeStepSchema = z.strictObject({
  from: GradeNameSchema,
  to: GradeNameSchema,
  minLevel: z.number().int().min(1).max(LEVEL_COUNT),
  /** Порог по каждой компетенции, не среднее. */
  minCompetency: z.number().min(0).max(100),
  requiredCategories: z.array(ScenarioCategorySchema).min(1),
  noSafetyFailsInLastRuns: z.number().int().nonnegative(),
});

type GradeDraft = z.infer<typeof GradeStepSchema>;

function checkGradeStep(grades: GradeDraft[], index: number, ctx: IssueSink): void {
  const expected = GRADE_CHAIN[index];
  const rule = grades[index];
  if (!expected || !rule) {
    return;
  }
  if (rule.from !== expected[0] || rule.to !== expected[1]) {
    ctx.addIssue(`переход ${index + 1} должен быть ${expected[0]} → ${expected[1]}`);
  }
  const unique = new Set(rule.requiredCategories);
  if (unique.size !== rule.requiredCategories.length) {
    ctx.addIssue(`переход ${rule.from} → ${rule.to}: категории повторяются`);
  }
  const previous = grades[index - 1];
  if (previous && rule.minLevel < previous.minLevel) {
    ctx.addIssue('minLevel растёт по цепочке грейдов');
  }
  if (previous && rule.minCompetency < previous.minCompetency) {
    ctx.addIssue('minCompetency растёт по цепочке грейдов');
  }
}

const GradesSchema = z.array(GradeStepSchema).superRefine((grades, ctx) => {
  if (grades.length !== GRADE_CHAIN.length) {
    ctx.addIssue('нужны три перехода TRAINEE → CONDUCTOR → CONDUCTOR_SENIOR → INSTRUCTOR');
    return;
  }
  for (let index = 0; index < grades.length; index += 1) {
    checkGradeStep(grades, index, ctx);
  }
});

export const RulesSchema = z
  .strictObject({
    scoring: ScoringSchema,
    levels: LevelsSchema,
    pointsTtlDays: z.number().int().positive(),
    expiryWarnDays: z.number().int().positive(),
    ewmaAlpha: z.number().gt(0).lte(1),
    weakScore: z.number().min(0).max(100),
    failScore: z.number().min(0).max(100),
    grades: GradesSchema,
  })
  .superRefine((rules, ctx) => {
    if (rules.expiryWarnDays >= rules.pointsTtlDays) {
      ctx.addIssue('expiryWarnDays меньше срока жизни баллов');
    }
    if (rules.failScore >= rules.weakScore) {
      ctx.addIssue('failScore ниже weakScore: провал шкалы строже просадки компетенции');
    }
  });

export type ScoringParams = z.infer<typeof ScoringSchema>;
export type GradeRule = z.infer<typeof GradeStepSchema>;
export type Rules = z.infer<typeof RulesSchema>;

export type LevelBand = {
  level: number;
  levelFrom: number;
  levelTo: number;
};

export function parseRules(raw: unknown): Rules {
  const result = RulesSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`rules.yaml не проходит схему: ${result.error.message}`);
  }
  return result.data;
}
