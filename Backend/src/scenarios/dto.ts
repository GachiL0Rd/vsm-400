import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import type { ScenarioGraph } from '../engine/schema';
import { CarClassSchema, CompetencySchema, StageSchema } from '../engine/schema';

export const CatalogItemSchema = z.strictObject({
  id: z.string(),
  title: z.string(),
  category: z.string(),
  carClasses: z.array(CarClassSchema),
  difficulty: z.number().int(),
  competencies: z.array(CompetencySchema),
  version: z.number().int(),
  stage: StageSchema,
});

export class CatalogItemDto extends createZodDto(CatalogItemSchema) {}

const ScenarioStatusName = z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']);

export const ScenarioDetailSchema = CatalogItemSchema.extend({
  status: ScenarioStatusName,
  graph: z.record(z.string(), z.unknown()),
});

export class ScenarioDetailDto extends createZodDto(ScenarioDetailSchema) {}

export const ScenarioStatusPatchSchema = z.strictObject({
  status: ScenarioStatusName,
});

export class ScenarioStatusDto extends createZodDto(ScenarioStatusPatchSchema) {}

export const ScenarioStatusViewSchema = z.strictObject({
  id: z.string(),
  status: ScenarioStatusName,
});

export class ScenarioStatusViewDto extends createZodDto(ScenarioStatusViewSchema) {}

export type CatalogItem = z.infer<typeof CatalogItemSchema>;
export type ScenarioStatusPatch = z.infer<typeof ScenarioStatusPatchSchema>;
export type ScenarioStatusView = z.infer<typeof ScenarioStatusViewSchema>;

export type ScenarioDetail = CatalogItem & {
  status: ScenarioStatusView['status'];
  graph: ScenarioGraph;
};
