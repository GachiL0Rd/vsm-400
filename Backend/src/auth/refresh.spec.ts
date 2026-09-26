import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '../generated/prisma/client';
import { rotateRefresh } from './refresh';

describe('rotateRefresh', () => {
  it('не выдаёт новую сессию, пока пароль обязателен', async () => {
    const create = vi.fn();
    const tx = {
      authSession: {
        findUnique: async () => ({
          replacedById: null,
          revokedAt: null,
          expiresAt: new Date('2030-01-01T00:00:00.000Z'),
          userId: 'user-1',
          user: { mustChangePassword: true, disabledAt: null },
        }),
        create,
        updateMany: vi.fn(),
        delete: vi.fn(),
      },
    };
    const outcome = await rotateRefresh(tx as unknown as Prisma.TransactionClient, 'raw-token', {
      ip: null,
      userAgent: null,
    });
    expect(outcome).toEqual({ kind: 'password' });
    expect(create).not.toHaveBeenCalled();
  });
});
