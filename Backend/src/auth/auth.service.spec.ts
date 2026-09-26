import { UnauthorizedException } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import { describe, expect, it, vi } from 'vitest';
import type { AuditService } from '../audit/audit.service';
import { ActorType } from '../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import type { PasswordService } from './password.service';

describe('неудачный вход', () => {
  it('пишет факт и ip, без введённого логина', async () => {
    const log = vi.fn(async () => undefined);
    const service = new AuthService(
      { user: { findUnique: async () => null } } as unknown as PrismaService,
      {} as JwtService,
      { verify: async () => false } as unknown as PasswordService,
      { log } as unknown as AuditService,
    );
    await expect(
      service.login('SecretLogin', 'pw', { ip: '203.0.113.9', userAgent: null }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(log).toHaveBeenCalledWith({
      actorType: ActorType.USER,
      actorId: null,
      action: 'auth.login.failure',
      target: null,
      ip: '203.0.113.9',
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain('SecretLogin');
  });
});
