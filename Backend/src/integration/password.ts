import { randomBytes, scryptSync } from 'node:crypto';

const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 32;

/**
 * Формат `scrypt$N$r$p$salt$hash`. UsersService задачи auth может
 * подменить алгоритм; префикс позволяет отличить эту запись.
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function generatePassword(): string {
  return randomBytes(18).toString('base64url');
}
