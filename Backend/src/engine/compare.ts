import type { Compare } from './schema';

const NUMERIC = ['lt', 'lte', 'gt', 'gte', 'eq'] as const;

type FlagState = {
  flags: readonly string[];
  params: Readonly<Record<string, number>>;
};

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
