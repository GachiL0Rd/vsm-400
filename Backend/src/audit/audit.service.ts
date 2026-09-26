import { Inject, Injectable } from '@nestjs/common';
import type { ActorType, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

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
