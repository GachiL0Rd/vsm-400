import { describe, expect, it } from 'vitest';
import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const passwords = new PasswordService();

  it('проверяет argon2id и не подтверждает пустой хэш', async () => {
    const hash = await passwords.hash('correct-horse');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await passwords.verify(hash, 'correct-horse')).toBe(true);
    expect(await passwords.verify(hash, 'other-horse-1')).toBe(false);
    expect(await passwords.verify(null, 'other-horse-1')).toBe(false);
  });
});
