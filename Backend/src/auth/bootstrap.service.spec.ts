import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuditService } from '../audit/audit.service';
import type { AppConfig } from '../config/env';
import type { PrismaService } from '../prisma/prisma.service';
import { BootstrapService, bootstrapPassword } from './bootstrap.service';
import type { PasswordService } from './password.service';

describe('bootstrapPassword', () => {
  const previous = process.env.BOOTSTRAP_ADMIN_PASSWORD;

  afterEach(() => {
    if (previous === undefined) {
      delete process.env.BOOTSTRAP_ADMIN_PASSWORD;
    } else {
      process.env.BOOTSTRAP_ADMIN_PASSWORD = previous;
    }
  });

  it('короче 10 символов и значение в production не принимает', () => {
    expect(() => bootstrapPassword({ BOOTSTRAP_ADMIN_PASSWORD: 'short' }, 'development')).toThrow(
      /10/,
    );
    expect(() =>
      bootstrapPassword({ BOOTSTRAP_ADMIN_PASSWORD: 'long-enough-password' }, 'production'),
    ).toThrow(/production/);
  });

  it('берёт env, иначе случайную строку длиннее 10', () => {
    process.env.BOOTSTRAP_ADMIN_PASSWORD = '  ci-admin-password  ';
    expect(bootstrapPassword()).toBe('ci-admin-password');
    delete process.env.BOOTSTRAP_ADMIN_PASSWORD;
    expect(bootstrapPassword()).toMatch(/^[A-Za-z0-9_-]{20,}$/);
  });
});

describe('BootstrapService', () => {
  const previous = process.env.BOOTSTRAP_ADMIN_PASSWORD;

  afterEach(() => {
    if (previous === undefined) {
      delete process.env.BOOTSTRAP_ADMIN_PASSWORD;
    } else {
      process.env.BOOTSTRAP_ADMIN_PASSWORD = previous;
    }
    vi.restoreAllMocks();
  });

  function harness(nodeEnv: AppConfig['nodeEnv'] = 'development') {
    let admins = 0;
    const user = {
      findFirst: vi.fn(async () => (admins > 0 ? { id: 'admin-id' } : null)),
      findUnique: vi.fn(async () => null),
      create: vi.fn(async () => {
        admins += 1;
        return { id: 'admin-id' };
      }),
    };
    const prisma = {
      user,
      $transaction: async (fn: (tx: { user: typeof user }) => Promise<boolean>) => fn({ user }),
    };
    const passwords = { hash: vi.fn(async (password: string) => `hash:${password}`) };
    const audit = { log: vi.fn(async () => undefined) };
    const service = new BootstrapService(
      prisma as unknown as PrismaService,
      passwords as unknown as PasswordService,
      audit as unknown as AuditService,
      { nodeEnv, port: 3210 } as AppConfig,
    );
    return { service, user, passwords, audit };
  }

  it('создаёт admin один раз и печатает пароль', async () => {
    process.env.BOOTSTRAP_ADMIN_PASSWORD = 'ci-admin-password';
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { service, user, passwords, audit } = harness();
    const first = await service.ensureAdmin();
    const second = await service.ensureAdmin();
    expect(first).toEqual({ login: 'admin', password: 'ci-admin-password' });
    expect(second).toBeNull();
    expect(user.create).toHaveBeenCalledTimes(1);
    expect(passwords.hash).toHaveBeenCalledTimes(1);
    expect(passwords.hash).toHaveBeenCalledWith('ci-admin-password');
    expect(audit.log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls.flat().join('\n')).toContain('ci-admin-password');
    expect(log.mock.calls.flat().join('\n')).toContain('http://localhost:3210/api/docs');
  });

  it('в test не трогает базу на старте', async () => {
    const { service, user } = harness('test');
    await service.onApplicationBootstrap();
    expect(user.findFirst).not.toHaveBeenCalled();
  });
});
