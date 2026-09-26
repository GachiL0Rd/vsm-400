/** Допуск сети и рассинхрона часов: и на дедлайн, и на «ответ до показа». */
export const SKEW_MS = 500;

export const REACTION_FAST_MS = 250;
export const MIN_REACTION_SAMPLES = 3;

export const FLAG_REACTION_FAST = 'reaction-fast';
export const FLAG_BEFORE_SHOW = 'decision-before-show';
export const FLAG_AFTER_DEADLINE = 'decision-after-deadline';
export const FLAG_TICKET_REUSED = 'ticket-reused';
export const FLAG_MULTI_SESSION = 'multi-session';
export const FLAG_SEQ_JUMP = 'seq-jump';

const CRITICAL = new Set<string>([
  FLAG_REACTION_FAST,
  FLAG_BEFORE_SHOW,
  FLAG_AFTER_DEADLINE,
  FLAG_TICKET_REUSED,
  FLAG_MULTI_SESSION,
  FLAG_SEQ_JUMP,
]);

export type TimingInput = {
  clientTs: number | null;
  shownAt: number | null;
  deadlineAt: number | null;
  now: number;
  choiceId: string;
};

export function isPastDeadline(deadlineMs: number | null, nowMs: number): boolean {
  if (deadlineMs === null) {
    return false;
  }
  return nowMs > deadlineMs + SKEW_MS;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = values.slice().sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid] ?? null;
  }
  const left = sorted[mid - 1];
  const right = sorted[mid];
  if (left === undefined || right === undefined) {
    return null;
  }
  return (left + right) / 2;
}

/** Систематически быстрые ходы. Timeout без reactionMs в выборку не входит. */
export function reactionFlag(reactions: readonly (number | null)[]): string | null {
  const samples: number[] = [];
  for (const reaction of reactions) {
    if (reaction !== null) {
      samples.push(reaction);
    }
  }
  if (samples.length < MIN_REACTION_SAMPLES) {
    return null;
  }
  const mid = median(samples);
  if (mid === null || mid >= REACTION_FAST_MS) {
    return null;
  }
  return FLAG_REACTION_FAST;
}

export function timingFlags(input: TimingInput): string[] {
  const flags: string[] = [];
  if (
    input.clientTs !== null &&
    input.shownAt !== null &&
    input.clientTs < input.shownAt - SKEW_MS
  ) {
    flags.push(FLAG_BEFORE_SHOW);
  }
  const late = isPastDeadline(input.deadlineAt, input.now);
  if (late && input.choiceId !== 'timeout') {
    flags.push(FLAG_AFTER_DEADLINE);
  }
  return flags;
}

export function mergeFlags(current: readonly string[], extra: readonly string[]): string[] {
  const next = current.slice();
  for (const flag of extra) {
    if (!next.includes(flag)) {
      next.push(flag);
    }
  }
  return next;
}

export function addedFlags(before: readonly string[], after: readonly string[]): string[] {
  const added: string[] = [];
  for (const flag of after) {
    if (!before.includes(flag)) {
      added.push(flag);
    }
  }
  return added;
}

export function isSuspicious(flags: readonly string[]): boolean {
  for (const flag of flags) {
    if (CRITICAL.has(flag)) {
      return true;
    }
  }
  return false;
}
