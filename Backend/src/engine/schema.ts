import { z } from 'zod';

export const CarClassSchema = z.enum(['ECONOMY', 'FAMILY', 'BUSINESS', 'FIRST']);
export const CompetencySchema = z.enum([
  'safety',
  'procedure',
  'detection',
  'reaction',
  'service',
  'escalation',
]);
export const StageSchema = z.enum(['acceptance', 'boarding', 'enroute', 'stop', 'handover']);
export const ScenarioCategorySchema = z.enum([
  'medical',
  'conflict',
  'safety',
  'technical',
  'service',
  'security',
]);
export const VerdictSchema = z.enum(['best', 'ok', 'worse', 'missed']);
export const EndOutcomeSchema = z.enum(['completed', 'incident', 'terminated']);

export type CarClass = z.infer<typeof CarClassSchema>;
export type Competency = z.infer<typeof CompetencySchema>;
export type Stage = z.infer<typeof StageSchema>;
export type Verdict = z.infer<typeof VerdictSchema>;
export type RunOutcome = z.infer<typeof EndOutcomeSchema>;

/** В примере §5 только `lt`. Остальные операторы — тот же объект сравнения. */
export const CompareSchema = z
  .strictObject({
    param: z.string().min(1).optional(),
    flag: z.string().min(1).optional().describe('Один флаг, который уже должен стоять'),
    flags: z
      .array(z.string().min(1))
      .min(1)
      .optional()
      .describe('Все перечисленные флаги должны стоять'),
    lt: z.number().optional(),
    lte: z.number().optional(),
    gt: z.number().optional(),
    gte: z.number().optional(),
    eq: z.number().optional(),
  })
  .refine(
    (value) =>
      value.lt !== undefined ||
      value.lte !== undefined ||
      value.gt !== undefined ||
      value.gte !== undefined ||
      value.eq !== undefined ||
      value.flag !== undefined ||
      value.flags !== undefined,
    { message: 'нужен оператор lt, lte, gt, gte, eq или флаг' },
  );

export const RangeSchema = z
  .strictObject({
    min: z.number(),
    max: z.number(),
  })
  .refine((value) => value.min <= value.max, { message: 'min больше max' });

export const VariantSchema = z.strictObject({
  if: CompareSchema,
  text: z.string(),
});

export const ScaleDeltaSchema = z
  .strictObject({
    safety: z.number().optional(),
    loyalty: z.number().optional(),
  })
  .refine((value) => value.safety !== undefined || value.loyalty !== undefined, {
    message: 'нужна хотя бы одна шкала',
  });

export const SkillsSchema = z.strictObject({
  safety: z.number().optional(),
  procedure: z.number().optional(),
  detection: z.number().optional(),
  reaction: z.number().optional(),
  service: z.number().optional(),
  escalation: z.number().optional(),
});

export const RequiresSchema = z.strictObject({
  flags: z.array(z.string().min(1)).min(1),
});

const flagList = z.array(z.string().min(1)).min(1);

export const EffectsIfSchema = z
  .strictObject({
    if: CompareSchema,
    effects: ScaleDeltaSchema.optional(),
    skills: SkillsSchema.optional(),
  })
  .describe('Добавка к эффекту, если условие совпало с params или флагами');

export const ChoiceSchema = z.strictObject({
  id: z.string().min(1),
  text: z.string(),
  effects: ScaleDeltaSchema.optional(),
  effectsIf: z.array(EffectsIfSchema).min(1).optional().describe('Условные эффекты поверх effects'),
  skills: SkillsSchema.optional(),
  set: flagList.optional(),
  verdict: VerdictSchema.optional(),
  better: z.string().optional(),
  basis: z.string().optional(),
  requires: RequiresSchema.optional(),
  deviation: z.boolean().optional(),
  consequence: z.string().optional().describe('Последствие этого выбора'),
  lucky: z.boolean().optional().describe('Решение удалось вопреки риску'),
  next: z.string().min(1),
});

export const TimeoutSchema = z.strictObject({
  effects: ScaleDeltaSchema.optional(),
  effectsIf: z.array(EffectsIfSchema).min(1).optional().describe('Условные эффекты таймаута'),
  set: flagList.optional(),
  verdict: VerdictSchema.optional(),
  better: z.string().optional().describe('Что стоило сделать вместо пропуска'),
  basis: z.string().optional().describe('Основание из регламента'),
  deviation: z.boolean().optional().describe('Нетиповое, но допустимое молчание'),
  consequence: z.string().optional(),
  lucky: z.boolean().optional().describe('Пропуск обошёлся удачей'),
  next: z.string().min(1),
});

export const DecisionNodeSchema = z.strictObject({
  text: z.string(),
  variants: z.array(VariantSchema).optional(),
  timer: z.number().int().positive().nullable().optional(),
  choices: z.array(ChoiceSchema).min(1),
  onTimeout: TimeoutSchema.optional(),
});

export const EndNodeSchema = z.strictObject({
  end: EndOutcomeSchema,
  text: z.string(),
  set: flagList.optional().describe('Флаги финала, в том числе complaint и intervention'),
  flags: flagList.optional().describe('Те же флаги финала, если автор написал flags'),
  complaint: z.boolean().optional().describe('Жалоба пассажира, если ход пришёл в этот финал'),
});

export const NodeSchema = z.union([EndNodeSchema, DecisionNodeSchema]);

export const LlmModeSchema = z.enum(['pool', 'live']);
export const LlmForbidSchema = z.enum(['medications', 'numbers', 'names', 'new-facts']);

/** LLM переписывает формулировки. id, эффекты, next и вердикт сюда не входят. */
export const LlmBlockSchema = z.strictObject({
  enabled: z.boolean().describe('Включать перефразы для этого сценария'),
  mode: LlmModeSchema.default('pool').describe(
    'pool берёт готовый пул, live добирает вариант на сессию',
  ),
  keep: z
    .array(z.string().min(1))
    .min(1)
    .optional()
    .describe('Смысловые якоря, которые обязаны остаться в тексте'),
  forbid: z
    .array(LlmForbidSchema)
    .min(1)
    .optional()
    .describe('Запреты валидатора: лекарства, цифры, имена, новые факты'),
  personas: z
    .array(z.string().min(1))
    .min(1)
    .optional()
    .describe('Манеры пассажира: из них выбирается персона сессии'),
});

export const GatesSchema = z.strictObject({
  failIf: z
    .strictObject({
      safety: CompareSchema.optional(),
      loyalty: CompareSchema.optional(),
    })
    .refine((value) => value.safety !== undefined || value.loyalty !== undefined, {
      message: 'failIf требует порог',
    }),
});

export const ScenarioGraphSchema = z.strictObject({
  id: z.string().min(1),
  title: z.string().min(1),
  category: ScenarioCategorySchema,
  stage: StageSchema,
  carClasses: z.array(CarClassSchema).min(1),
  difficulty: z.number().int().min(1).max(3),
  competencies: z.array(CompetencySchema).min(1),
  params: z.record(z.string(), RangeSchema).optional(),
  init: z.strictObject({
    loyalty: z.number().min(0).max(100),
    safety: z.number().min(0).max(100),
  }),
  gates: GatesSchema.optional(),
  llm: LlmBlockSchema.optional(),
  start: z.string().min(1),
  nodes: z.record(z.string(), NodeSchema),
});

export type LlmMode = z.infer<typeof LlmModeSchema>;
export type LlmForbid = z.infer<typeof LlmForbidSchema>;
export type LlmBlock = z.infer<typeof LlmBlockSchema>;
export type Compare = z.infer<typeof CompareSchema>;
export type EffectsIf = z.infer<typeof EffectsIfSchema>;
export type ScenarioGraph = z.infer<typeof ScenarioGraphSchema>;
export type ScenarioNode = z.infer<typeof NodeSchema>;
export type DecisionNode = z.infer<typeof DecisionNodeSchema>;
export type EndNode = z.infer<typeof EndNodeSchema>;

/** Связность графа (next, onTimeout, недостижимые узлы) — validateScenario, не эта схема. */
export function isEndNode(node: ScenarioNode): node is EndNode {
  return 'end' in node;
}
