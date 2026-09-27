import { z } from 'zod';
import {
  EndOutcomeSchema,
  ScenarioCategorySchema,
  StageSchema,
  VerdictSchema,
} from '../engine/schema';

const WhereSchema = z
  .strictObject({
    verdict: VerdictSchema.optional(),
    stage: StageSchema.optional(),
    category: ScenarioCategorySchema.optional(),
    categories: z.array(ScenarioCategorySchema).min(1).optional(),
    outcome: EndOutcomeSchema.optional(),
    maxReactionMs: z.number().int().nonnegative().optional(),
    minReactionMs: z.number().int().nonnegative().optional(),
    /** Реакция не дольше половины timerSec узла. */
    withinHalfTimer: z.literal(true).optional(),
    lucky: z.boolean().optional(),
    deviation: z.boolean().optional(),
    choiceIncludes: z.string().min(1).optional(),
    /** choiceId равен одному из значений. У факта игры это kind. */
    choices: z.array(z.string().min(1)).min(1).optional(),
    /** Подстрока situation, без учёта регистра. */
    situationIncludes: z.string().min(1).optional(),
    minSafetyDelta: z.number().optional(),
    complaintsMax: z.number().int().nonnegative().optional(),
    incidentsMax: z.number().int().nonnegative().optional(),
    preventedMin: z.number().int().nonnegative().optional(),
    interventionsMin: z.number().int().nonnegative().optional(),
    minSafety: z.number().optional(),
    missedMax: z.number().int().nonnegative().optional(),
    /** Сколько решений с choiceId timeout. Колонки timeouts у Run нет. */
    timeoutsMax: z.number().int().nonnegative().optional(),
    minDecisions: z.number().int().positive().optional(),
    /** Для condition: сколько решений рейса должны совпасть. По умолчанию 1. */
    minMatches: z.number().int().positive().optional(),
  })
  .refine((where) => Object.values(where).some((value) => value !== undefined), {
    message: 'where пустой',
  });

export type Where = z.infer<typeof WhereSchema>;

const DECISION_KEYS = [
  'verdict',
  'stage',
  'category',
  'categories',
  'maxReactionMs',
  'minReactionMs',
  'withinHalfTimer',
  'lucky',
  'deviation',
  'choiceIncludes',
  'choices',
  'situationIncludes',
  'minSafetyDelta',
] as const satisfies readonly (keyof Where)[];

export function whereFiltersDecisions(where: Where): boolean {
  return DECISION_KEYS.some((key) => where[key] !== undefined);
}

const ConditionRuleSchema = z.strictObject({
  on: z.literal('run.recorded'),
  type: z.literal('condition'),
  where: WhereSchema,
});

const CountRuleSchema = z
  .strictObject({
    on: z.literal('run.recorded'),
    type: z.literal('count'),
    where: WhereSchema,
    total: z.number().int().positive(),
  })
  .superRefine((rule, ctx) => {
    if (!whereFiltersDecisions(rule.where)) {
      ctx.addIssue('count считает решения: в where нужен фильтр решения');
    }
  });

const StreakRuleSchema = z.strictObject({
  on: z.literal('run.recorded'),
  type: z.literal('streak'),
  total: z.number().int().positive(),
});

export const RuleSchema = z.discriminatedUnion('type', [
  ConditionRuleSchema,
  CountRuleSchema,
  StreakRuleSchema,
]);

export type AchievementRule = z.infer<typeof RuleSchema>;

const CodeSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const AchievementEntrySchema = z.strictObject({
  code: CodeSchema,
  title: z.string().min(1),
  description: z.string().min(1),
  hidden: z.boolean().optional(),
  bonusPoints: z.number().int().nonnegative(),
  rule: RuleSchema,
});

export type AchievementEntry = z.infer<typeof AchievementEntrySchema>;

export const AchievementsFileSchema = z
  .strictObject({
    achievements: z.array(AchievementEntrySchema).min(12).max(16),
  })
  .superRefine((file, ctx) => {
    const seen = new Set<string>();
    for (const entry of file.achievements) {
      if (seen.has(entry.code)) {
        ctx.addIssue(`код ${entry.code} повторяется`);
      }
      seen.add(entry.code);
    }
  });

export type AchievementsFile = z.infer<typeof AchievementsFileSchema>;

export function parseAchievements(raw: unknown): AchievementsFile {
  const result = AchievementsFileSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`achievements.yaml не проходит схему: ${result.error.message}`);
  }
  return result.data;
}

export function ruleTotal(rule: AchievementRule): number | null {
  return rule.type === 'condition' ? null : rule.total;
}
