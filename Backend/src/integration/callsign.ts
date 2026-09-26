import { randomBytes } from 'node:crypto';

/** Без I, O, 0, 1: позывной читают вслух и сличают с экраном. */
// biome-ignore lint/security/noSecrets: алфавит позывного, не секрет
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomCallsign(): string {
  const bytes = randomBytes(4);
  let callsign = '';
  for (const byte of bytes) {
    const index = byte % ALPHABET.length;
    callsign += ALPHABET[index] ?? 'A';
  }
  return callsign;
}
