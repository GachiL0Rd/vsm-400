import { Inject, Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { ActorType, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Дольше этого окна ip, userAgent и target аудита не нужны для разбора. */
export const PRIVACY_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export type AuditEntry = {
  actorType: ActorType;
  actorId?: string | null;
  action: string;
  target?: string | null;
  meta?: Prisma.InputJsonValue;
  ip?: string | null;
};

@Injectable()
export class AuditService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async log(entry: AuditEntry): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actorType: entry.actorType,
        actorId: entry.actorId ?? null,
        action: entry.action,
        target: entry.target ?? null,
        meta: entry.meta,
        ip: entry.ip ?? null,
      },
    });
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'privacy-retention' })
  async retainPrivacy(now = new Date()): Promise<void> {
    const cutoff = new Date(now.getTime() - PRIVACY_RETENTION_MS);
    await this.prisma.authSession.updateMany({
      where: {
        createdAt: { lt: cutoff },
        OR: [{ ip: { not: null } }, { userAgent: { not: null } }],
      },
      data: { ip: null, userAgent: null },
    });
    await this.prisma.authSession.deleteMany({
      where: { expiresAt: { lt: now } },
    });
    await this.prisma.auditLog.updateMany({
      where: {
        at: { lt: cutoff },
        OR: [{ ip: { not: null } }, { target: { not: null } }],
      },
      data: { ip: null, target: null },
    });
  }

  async list(page: number, limit: number) {
    const where = {};
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: [{ at: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return {
      items: rows.map((row) => ({
        id: row.id.toString(),
        actorType: row.actorType,
        actorId: row.actorId,
        action: row.action,
        target: row.target,
        meta: row.meta,
        ip: row.ip,
        at: row.at.toISOString(),
      })),
      page,
      limit,
      total,
    };
  }
}
