import { UnprocessableEntityException } from '@nestjs/common';
import type { ScenarioGraph } from '../engine/schema';
import { type ValidationIssue, validateScenario } from '../engine/validate';

/** Связность графа. Предупреждение FLAG_NEVER_SET граф не бракует. */
export function playableIssues(graph: ScenarioGraph): ValidationIssue[] {
  const result = validateScenario(graph);
  if (result.ok) {
    return [];
  }
  return result.errors.filter((issue) => issue.code !== 'FLAG_NEVER_SET');
}

export function assertPlayableGraph(graph: ScenarioGraph): void {
  const errors = playableIssues(graph);
  if (errors.length === 0) {
    return;
  }
  throw new UnprocessableEntityException({
    message: 'Граф сценария не связан',
    code: 'VALIDATION',
    errors: errors.map((issue) => ({
      path: issue.path,
      code: issue.code,
      message: issue.message,
    })),
  });
}
