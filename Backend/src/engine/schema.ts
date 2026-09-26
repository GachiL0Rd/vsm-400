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
      value.eq !== undefined,
    { message: 'нужен оператор lt, lte, gt, gte или eq' },
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

export const ChoiceSchema = z.strictObject({
  id: z.string().min(1),
  text: z.string(),
  effects: ScaleDeltaSchema.optional(),
  skills: SkillsSchema.optional(),
  set: flagList.optional(),
  verdict: VerdictSchema.optional(),
  better: z.string().optional(),
  basis: z.string().optional(),
  requires: RequiresSchema.optional(),
  deviation: z.boolean().optional(),
  next: z.string().min(1),
});

export const TimeoutSchema = z.strictObject({
  effects: ScaleDeltaSchema.optional(),
  set: flagList.optional(),
  verdict: VerdictSchema.optional(),
  consequence: z.string().optional(),
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
});

export const NodeSchema = z.union([EndNodeSchema, DecisionNodeSchema]);

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
  start: z.string().min(1),
  nodes: z.record(z.string(), NodeSchema),
});

export type ScenarioGraph = z.infer<typeof ScenarioGraphSchema>;
export type ScenarioNode = z.infer<typeof NodeSchema>;
export type DecisionNode = z.infer<typeof DecisionNodeSchema>;
export type EndNode = z.infer<typeof EndNodeSchema>;

/** Связность графа (next, onTimeout, недостижимые узлы) — validateScenario, не эта схема. */
export function isEndNode(node: ScenarioNode): node is EndNode {
  return 'end' in node;
}
