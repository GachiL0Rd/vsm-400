import { describe, expect, it, vi } from 'vitest';
import { SystemClock } from '../common/clock';
import type { PrismaService } from '../prisma/prisma.service';
import { AuditService, PRIVACY_RETENTION_MS } from './audit.service';

describe('срок хранения', () => {
  it('обнуляет старые ip и удаляет просроченные сессии', async () => {
    const sessionUpdate = vi.fn(async () => ({ count: 1 }));
    const sessionDelete = vi.fn(async () => ({ count: 2 }));
    const auditUpdate = vi.fn(async () => ({ count: 3 }));
    const service = new AuditService(
      {
        authSession: { updateMany: sessionUpdate, deleteMany: sessionDelete },
        auditLog: { updateMany: auditUpdate },
      } as unknown as PrismaService,
      new SystemClock(),
    );
    const now = new Date('2026-09-27T00:00:00.000Z');
    await service.retainPrivacy(now);
    const cutoff = new Date(now.getTime() - PRIVACY_RETENTION_MS);
    expect(sessionUpdate).toHaveBeenCalledWith({
      where: {
        createdAt: { lt: cutoff },
        OR: [{ ip: { not: null } }, { userAgent: { not: null } }],
      },
      data: { ip: null, userAgent: null },
    });
    expect(sessionDelete).toHaveBeenCalledWith({ where: { expiresAt: { lt: now } } });
    expect(auditUpdate).toHaveBeenCalledWith({
      where: {
        at: { lt: cutoff },
        OR: [{ ip: { not: null } }, { target: { not: null } }],
      },
      data: { ip: null, target: null },
    });
  });
});
