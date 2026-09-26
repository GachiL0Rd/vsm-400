import type { Competency } from './schema';
import { readSkills } from './skills';

/** CompareSchema плюс flag: в schema.ts флага нет, контент может принести его мимо strict-zod. */
export type Compare = {
  param?: string;
  flag?: string;
  flags?: string[];
  lt?: number;
  lte?: number;
  gt?: number;
  gte?: number;
  eq?: number;
};

export type EffectsIf = {
  if: Compare;
  effects?: { safety?: number; loyalty?: number };
  skills?: Partial<Record<Competency, number>>;
};

const NUMERIC = ['lt', 'lte', 'gt', 'gte', 'eq'] as const;

type FlagState = {
  flags: readonly string[];
  params: Readonly<Record<string, number>>;
};

export function asCompare(value: object): Compare {
  const record = value as Record<string, unknown>;
  const compare: Compare = {};
  if (typeof record.param === 'string') {
    compare.param = record.param;
  }
  if (typeof record.flag === 'string') {
    compare.flag = record.flag;
  }
  if (Array.isArray(record.flags)) {
    const flags = record.flags.filter((item): item is string => typeof item === 'string');
    if (flags.length > 0) {
      compare.flags = flags;
    }
  }
  for (const key of NUMERIC) {
    const raw = record[key];
    if (typeof raw === 'number') {
      compare[key] = raw;
    }
  }
  return compare;
}

export function hasNumeric(compare: Compare): boolean {
  for (const key of NUMERIC) {
    if (compare[key] !== undefined) {
      return true;
    }
  }
  return false;
}

export function numericHolds(compare: Compare, value: number): boolean {
  if (!hasNumeric(compare)) {
    return false;
  }
  if (compare.lt !== undefined && !(value < compare.lt)) {
    return false;
  }
  if (compare.lte !== undefined && !(value <= compare.lte)) {
    return false;
  }
  if (compare.gt !== undefined && !(value > compare.gt)) {
    return false;
  }
  if (compare.gte !== undefined && !(value >= compare.gte)) {
    return false;
  }
  if (compare.eq !== undefined && value !== compare.eq) {
    return false;
  }
  return true;
}

export function conditionHolds(compare: Compare, state: FlagState): boolean {
  if (!flagsOk(compare, state.flags)) {
    return false;
  }
  if (compare.param !== undefined) {
    const value = state.params[compare.param];
    if (value === undefined) {
      return false;
    }
    return numericHolds(compare, value);
  }
  if (hasNumeric(compare)) {
    return false;
  }
  return hasFlag(compare);
}

export function readEffectsIf(source: object): EffectsIf[] {
  const raw = (source as { effectsIf?: unknown }).effectsIf;
  if (!Array.isArray(raw)) {
    return [];
  }
  const branches: EffectsIf[] = [];
  for (const item of raw) {
    const branch = readBranch(item);
    if (branch) {
      branches.push(branch);
    }
  }
  return branches;
}

function flagsOk(compare: Compare, flags: readonly string[]): boolean {
  if (compare.flag !== undefined && !flags.includes(compare.flag)) {
    return false;
  }
  if (!compare.flags) {
    return true;
  }
  for (const flag of compare.flags) {
    if (!flags.includes(flag)) {
      return false;
    }
  }
  return true;
}

function hasFlag(compare: Compare): boolean {
  if (compare.flag !== undefined) {
    return true;
  }
  return compare.flags !== undefined && compare.flags.length > 0;
}

function readBranch(value: unknown): EffectsIf | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.if !== 'object' || record.if === null) {
    return null;
  }
  const branch: EffectsIf = { if: asCompare(record.if) };
  const effects = readScale(record.effects);
  if (effects) {
    branch.effects = effects;
  }
  const skills = readSkills(record.skills);
  if (skills) {
    branch.skills = skills;
  }
  return branch;
}

function readScale(value: unknown): { safety?: number; loyalty?: number } | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const effects: { safety?: number; loyalty?: number } = {};
  if (typeof record.safety === 'number') {
    effects.safety = record.safety;
  }
  if (typeof record.loyalty === 'number') {
    effects.loyalty = record.loyalty;
  }
  if (effects.safety === undefined && effects.loyalty === undefined) {
    return undefined;
  }
  return effects;
}
