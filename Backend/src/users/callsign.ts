import { randomBytes } from 'node:crypto';

// Алфавит позывного, не секрет. Высокая энтропия — ложное срабатывание.
// biome-ignore lint/security/noSecrets: алфавит [A-Z0-9]
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const ALPHABET_SIZE = ALPHABET.length;
const UNBIASED_LIMIT = 252;

export function randomCallsign(): string {
  const chars: string[] = [];
  while (chars.length < 4) {
    const bytes = randomBytes(8);
    for (const byte of bytes) {
      if (byte >= UNBIASED_LIMIT) {
        continue;
      }
      chars.push(ALPHABET[byte % ALPHABET_SIZE] ?? 'A');
      if (chars.length === 4) {
        break;
      }
    }
  }
  return chars.join('');
}

export async function allocateCallsign(
  exists: (callsign: string) => Promise<boolean>,
  random: () => string = randomCallsign,
): Promise<string> {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const callsign = random();
    if (!(await exists(callsign))) {
      return callsign;
    }
  }
  throw new Error('CALLSIGN_EXHAUSTED');
}
