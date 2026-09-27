import { type ScenarioGraph, ScenarioGraphSchema } from '../engine/schema';

/** Адрес PUT и id внутри графа — одна сущность, иначе это другой сценарий. */
export function parseIncomingGraph(id: string, raw: unknown): ScenarioGraph {
  const parsed = ScenarioGraphSchema.superRefine((graph, ctx) => {
    if (graph.id !== id) {
      ctx.addIssue({
        code: 'custom',
        path: ['id'],
        message: 'id графа не совпадает с адресом',
      });
    }
  }).safeParse(raw);
  if (!parsed.success) {
    throw parsed.error;
  }
  return parsed.data;
}
