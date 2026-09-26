import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const IV_LEN = 12;
const TAG_LEN = 16;

/**
 * Seed в БД только шифром: дамп не раскрывает броски.
 * После смены reveal расшифровывает тем же ключом, commit сверяется с sha256.
 */
export function encryptSeed(seed: Buffer, keyHex: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', keyOf(keyHex), iv);
  const ciphertext = Buffer.concat([cipher.update(seed), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString('base64url');
}

export function decryptSeed(packed: string, keyHex: string): Buffer {
  const raw = Buffer.from(packed, 'base64url');
  if (raw.length < IV_LEN + TAG_LEN + 1) {
    throw new Error('SEED_BOX');
  }
  const iv = raw.subarray(0, IV_LEN);
  const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const data = raw.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv('aes-256-gcm', keyOf(keyHex), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

function keyOf(keyHex: string): Buffer {
  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== 32) {
    throw new Error('SEED_BOX_KEY');
  }
  return key;
}
