import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { argon2id, hash, verify } from 'argon2';

/** OWASP Password Storage: argon2id, 19 МиБ, t=2, p=1. */
const ARGON = {
  type: argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

@Injectable()
export class PasswordService {
  private dummy: Promise<string> | null = null;

  hash(password: string): Promise<string> {
    return hash(password, ARGON);
  }

  /**
   * Нет пользователя — всё равно verify по заранее посчитанному хэшу,
   * чтобы время ответа не выдавало отсутствие логина.
   */
  async verify(passwordHash: string | null, password: string): Promise<boolean> {
    const digest = passwordHash ?? (await this.placeholder());
    try {
      const ok = await verify(digest, password);
      return passwordHash !== null && ok;
    } catch {
      await verify(await this.placeholder(), password).catch(() => false);
      return false;
    }
  }

  private placeholder(): Promise<string> {
    this.dummy ??= hash(randomBytes(32).toString('hex'), ARGON);
    return this.dummy;
  }
}
