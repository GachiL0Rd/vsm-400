import type { CarClass, Competency } from '../generated/prisma/client';
import { competencyTitle } from './competency-label';

export type AdviceScenario = {
  title: string;
  carClasses: readonly CarClass[];
  competencies: readonly Competency[];
};

export function adviceText(
  competency: Competency,
  mine: number,
  average: number,
  scenarioTitle: string | null,
): string {
  const label = competencyTitle(competency);
  const base = `${label} ниже среднего по депо — ${mine} из 100 при среднем ${average}`;
  if (!scenarioTitle) {
    return `${base}.`;
  }
  return `${base}. Потренируйте «${scenarioTitle}».`;
}

export function adviceTitle(competency: Competency): string {
  return `${competencyTitle(competency)} ниже среднего по депо`;
}

/** Сначала сценарий своего класса вагона, иначе любой с этой компетенцией. */
export function recommendScenario(
  scenarios: readonly AdviceScenario[],
  competency: Competency,
  carClasses: readonly CarClass[],
): string | null {
  const pool: AdviceScenario[] = [];
  for (const scenario of scenarios) {
    if (scenario.competencies.includes(competency)) {
      pool.push(scenario);
    }
  }
  if (pool.length === 0) {
    return null;
  }
  if (carClasses.length > 0) {
    for (const scenario of pool) {
      if (intersects(scenario.carClasses, carClasses)) {
        return scenario.title;
      }
    }
  }
  return pool[0]?.title ?? null;
}

function intersects(left: readonly CarClass[], right: readonly CarClass[]): boolean {
  for (const item of left) {
    if (right.includes(item)) {
      return true;
    }
  }
  return false;
}
