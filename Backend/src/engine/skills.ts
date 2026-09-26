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

export function readSkills(value: unknown): Partial<Record<Competency, number>> | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const skills: Partial<Record<Competency, number>> = {};
  let found = false;
  for (const key of COMPETENCIES) {
    const delta = record[key];
    if (typeof delta !== 'number') {
      continue;
    }
    skills[key] = delta;
    found = true;
  }
  if (!found) {
    return undefined;
  }
  return skills;
}
