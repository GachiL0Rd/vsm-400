import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const VariantStatusSchema = z.enum(['PENDING_REVIEW', 'APPROVED', 'REJECTED', 'RETIRED']);

const blankToUndefined = (value: unknown) =>
  value === undefined || value === '' ? undefined : value;

export const VariantListQuerySchema = z.strictObject({
  status: z.preprocess(blankToUndefined, VariantStatusSchema.optional()),
  nodeId: z.preprocess(blankToUndefined, z.string().min(1).optional()),
});

export const RejectVariantSchema = z.strictObject({
  reason: z.string().trim().min(1).max(500),
});

export const GenerateVariantsSchema = z.strictObject({
  nodeId: z.string().min(1).optional(),
  count: z.number().int().min(1).max(20).optional(),
});

const ChoiceSchema = z.strictObject({
  id: z.string(),
  text: z.string(),
});

const PayloadSchema = z.strictObject({
  text: z.string(),
  choices: z.array(ChoiceSchema),
});

export const VariantViewSchema = z.strictObject({
  id: z.string(),
  scenarioId: z.string(),
  version: z.number().int(),
  nodeId: z.string(),
  persona: z.string(),
  promptVersion: z.string(),
  model: z.string(),
  payload: PayloadSchema,
  status: VariantStatusSchema,
  uses: z.number().int(),
  maxUses: z.number().int(),
  createdAt: z.string(),
  reviewedAt: z.string().nullable(),
  rejectReason: z.string().nullable(),
  reason: z.enum(['SEED', 'REFILL', 'LIVE', 'MANUAL']),
  sessionId: z.string().nullable(),
});

export const VariantListSchema = z.strictObject({
  items: z.array(VariantViewSchema),
});

export const GenerateResultSchema = z.strictObject({
  enqueued: z.number().int(),
});

const PoolBucketSchema = z.strictObject({
  scenarioId: z.string(),
  version: z.number().int(),
  approved: z.number().int(),
  pending: z.number().int(),
  rejected: z.number().int(),
  retired: z.number().int(),
});

const LlmErrorSchema = z.strictObject({
  at: z.string(),
  scenarioId: z.string(),
  nodeId: z.string(),
  message: z.string(),
});

export const LlmStatusSchema = z.strictObject({
  provider: z.string(),
  model: z.string().nullable(),
  queue: z.strictObject({
    waiting: z.number().int(),
    active: z.number().int(),
    failed: z.number().int(),
    delayed: z.number().int(),
  }),
  rejected: z.number().int(),
  pool: z.array(PoolBucketSchema),
  errors: z.array(LlmErrorSchema),
});

export class VariantViewDto extends createZodDto(VariantViewSchema) {}
export class VariantListDto extends createZodDto(VariantListSchema) {}
export class RejectVariantDto extends createZodDto(RejectVariantSchema) {}
export class GenerateVariantsDto extends createZodDto(GenerateVariantsSchema) {}
export class GenerateResultDto extends createZodDto(GenerateResultSchema) {}
export class LlmStatusDto extends createZodDto(LlmStatusSchema) {}
