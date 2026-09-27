import type { Competency } from './schema';

export const COMPETENCIES: readonly Competency[] = [
  'safety',
  'procedure',
  'detection',
  'reaction',
  'service',
  'escalation',
];

export function addSkills(
  target: Partial<Record<Competency, number>>,
  source: Partial<Record<Competency, number>> | undefined,
): void {
  if (!source) {
    return;
  }
  for (const key of COMPETENCIES) {
    const delta = source[key];
    if (delta === undefined) {
      continue;
    }
    target[key] = (target[key] ?? 0) + delta;
  }
}

export function copySkills(
  source: Partial<Record<Competency, number>> | undefined,
): Partial<Record<Competency, number>> {
  const copy: Partial<Record<Competency, number>> = {};
  addSkills(copy, source);
  return copy;
}
