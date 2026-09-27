import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '../generated/prisma/client';
import { REFRESH_RACE_WINDOW_MS, refreshExpiry, rotateRefresh } from './refresh';

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
    const outcome = await rotateRefresh(
      tx as unknown as Prisma.TransactionClient,
      'raw-token',
      { ip: null, userAgent: null },
      new Date('2026-09-27T12:00:00.000Z'),
    );
    expect(outcome).toEqual({ kind: 'password' });
    expect(create).not.toHaveBeenCalled();
  });

  it('срок и отзыв считает от переданного now', async () => {
    const now = new Date('2026-09-27T12:00:00.000Z');
    const create = vi.fn(async () => ({ id: 'next-session' }));
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const tx = {
      authSession: {
        findUnique: async () => ({
          id: 'old-session',
          replacedById: null,
          revokedAt: null,
          expiresAt: new Date('2026-09-28T00:00:00.000Z'),
          userId: 'user-1',
          user: { mustChangePassword: false, disabledAt: null },
        }),
        create,
        updateMany,
        delete: vi.fn(),
      },
    };
    const outcome = await rotateRefresh(
      tx as unknown as Prisma.TransactionClient,
      'raw-token',
      { ip: null, userAgent: null },
      now,
    );
    expect(outcome.kind).toBe('ok');
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ expiresAt: refreshExpiry(now) }),
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'old-session', replacedById: null, revokedAt: null },
      data: { revokedAt: now, replacedById: 'next-session' },
    });
    const expired = {
      authSession: {
        findUnique: async () => ({
          replacedById: null,
          revokedAt: null,
          expiresAt: now,
          userId: 'user-1',
          user: { mustChangePassword: false, disabledAt: null },
        }),
        create: vi.fn(),
      },
    };
    await expect(
      rotateRefresh(
        expired as unknown as Prisma.TransactionClient,
        'raw-token',
        { ip: null, userAgent: null },
        now,
      ),
    ).resolves.toEqual({ kind: 'invalid' });
  });

  it('замена моложе окна — гонка, сессии не отзывает', async () => {
    const now = new Date('2026-09-27T12:00:00.000Z');
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const tx = {
      authSession: {
        findUnique: async () => ({
          id: 'old-session',
          replacedById: 'winner',
          revokedAt: new Date(now.getTime() - REFRESH_RACE_WINDOW_MS + 1),
          expiresAt: new Date('2026-09-28T00:00:00.000Z'),
          userId: 'user-1',
          user: { mustChangePassword: false, disabledAt: null },
        }),
        create: vi.fn(),
        updateMany,
        delete: vi.fn(),
      },
    };
    await expect(
      rotateRefresh(
        tx as unknown as Prisma.TransactionClient,
        'raw-token',
        { ip: null, userAgent: null },
        now,
      ),
    ).resolves.toEqual({ kind: 'race', userId: 'user-1' });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('замена старше окна — reuse и отзыв живых сессий', async () => {
    const now = new Date('2026-09-27T12:00:00.000Z');
    const updateMany = vi.fn(async () => ({ count: 2 }));
    const tx = {
      authSession: {
        findUnique: async () => ({
          id: 'old-session',
          replacedById: 'winner',
          revokedAt: new Date(now.getTime() - REFRESH_RACE_WINDOW_MS),
          expiresAt: new Date('2026-09-28T00:00:00.000Z'),
          userId: 'user-1',
          user: { mustChangePassword: false, disabledAt: null },
        }),
        create: vi.fn(),
        updateMany,
        delete: vi.fn(),
      },
    };
    await expect(
      rotateRefresh(
        tx as unknown as Prisma.TransactionClient,
        'raw-token',
        { ip: null, userAgent: null },
        now,
      ),
    ).resolves.toEqual({ kind: 'reuse', userId: 'user-1' });
    expect(updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', revokedAt: null },
      data: { revokedAt: now },
    });
  });

  it('проигравший параллельный refresh удаляет свою сессию и не гасит победителя', async () => {
    const now = new Date('2026-09-27T12:00:00.000Z');
    let reads = 0;
    const updateMany = vi.fn(async () => ({ count: 0 }));
    const remove = vi.fn(async () => ({ id: 'orphan' }));
    const tx = {
      authSession: {
        findUnique: async () => {
          reads += 1;
          if (reads === 1) {
            return {
              id: 'old-session',
              replacedById: null,
              revokedAt: null,
              expiresAt: new Date('2026-09-28T00:00:00.000Z'),
              userId: 'user-1',
              user: { mustChangePassword: false, disabledAt: null },
            };
          }
          return { replacedById: 'winner', revokedAt: now };
        },
        create: async () => ({ id: 'orphan' }),
        updateMany,
        delete: remove,
      },
    };
    await expect(
      rotateRefresh(
        tx as unknown as Prisma.TransactionClient,
        'raw-token',
        { ip: null, userAgent: null },
        now,
      ),
    ).resolves.toEqual({ kind: 'race', userId: 'user-1' });
    expect(remove).toHaveBeenCalledWith({ where: { id: 'orphan' } });
    expect(updateMany).toHaveBeenCalledTimes(1);
  });
});
