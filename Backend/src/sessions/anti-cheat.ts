export const FLAG_TICKET_REUSED = 'ticket-reused';

/** Обнуляют очки рейса, пока человек не снимет подозрение. */
export const CRITICAL_FLAGS = [FLAG_TICKET_REUSED] as const;

const CRITICAL = new Set<string>(CRITICAL_FLAGS);

export function mergeFlags(current: readonly string[], extra: readonly string[]): string[] {
  const next = current.slice();
  for (const flag of extra) {
    if (!next.includes(flag)) {
      next.push(flag);
    }
  }
  return next;
}

export function isSuspicious(flags: readonly string[]): boolean {
  for (const flag of flags) {
    if (CRITICAL.has(flag)) {
      return true;
    }
  }
  return false;
}
