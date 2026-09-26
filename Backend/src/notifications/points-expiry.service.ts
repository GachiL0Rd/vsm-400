import { Inject, Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Clock } from '../common/clock';
import { LedgerReason, NotificationKind } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RulesService } from '../rules/rules.service';
import { NotificationsService } from './notifications.service';
import { EXPIRY_HINT, expiryTitle } from './ru-format';

const BATCH = 200;
const DAY_MS = 24 * 60 * 60 * 1000;

type Accrual = {
  id: string;
  userId: string;
  amount: number;
  runId: string | null;
  expiresAt: Date | null;
};

@Injectable()
export class PointsExpiryService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RulesService) private readonly rules: RulesService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  @Cron(CronExpression.EVERY_HOUR, {
    name: 'social-points-expire',
    timeZone: 'Europe/Moscow',
    waitForCompletion: true,
  })
  async expireDue(at?: Date): Promise<{ expired: number; warned: number }> {
    const now = at ?? this.clock.now();
    const expired = await this.expireAccruals(now);
    const warned = await this.warnAccruals(now);
    return { expired, warned };
  }

  private async expireAccruals(now: Date): Promise<number> {
    let expired = 0;
    for (;;) {
      const rows = await this.prisma.pointLedger.findMany({
        where: {
          expiredAt: null,
          expiresAt: { lt: now },
          amount: { gt: 0 },
        },
        orderBy: { expiresAt: 'asc' },
        take: BATCH,
      });
      if (rows.length === 0) {
        return expired;
      }
      let progressed = 0;
      for (const row of rows) {
        if (await this.expireOne(row, now)) {
          progressed += 1;
        }
      }
      expired += progressed;
      // Чужой воркер уже пометил строки — не крутить тот же батч до следующего часа.
      if (progressed === 0 || rows.length < BATCH) {
        return expired;
      }
    }
  }

  /** updateMany с expiredAt=null — второй проход того же часа не пишет ещё один EXPIRE. */
  private async expireOne(row: Accrual, now: Date): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.pointLedger.updateMany({
        where: { id: row.id, expiredAt: null },
        data: { expiredAt: now },
      });
      if (claimed.count !== 1) {
        return false;
      }
      await tx.pointLedger.create({
        data: {
          userId: row.userId,
          amount: -row.amount,
          reason: LedgerReason.EXPIRE,
          runId: row.runId,
          expiredAt: now,
        },
      });
      return true;
    });
  }

  private async warnAccruals(now: Date): Promise<number> {
    const horizon = new Date(now.getTime() + this.rules.expiryWarnDays() * DAY_MS);
    const where = {
      expiredAt: null,
      amount: { gt: 0 },
      expiresAt: { gt: now, lte: horizon },
    };
    let warned = 0;
    let skip = 0;
    for (;;) {
      const rows = await this.prisma.pointLedger.findMany({
        where,
        orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
        skip,
        take: BATCH,
      });
      if (rows.length === 0) {
        return warned;
      }
      for (const row of rows) {
        if (await this.warnOne(row)) {
          warned += 1;
        }
      }
      if (rows.length < BATCH) {
        return warned;
      }
      skip += rows.length;
    }
  }

  private async warnOne(row: Accrual): Promise<boolean> {
    if (!row.expiresAt) {
      return false;
    }
    const dedupKey = `ledger:${row.id}`;
    const existing = await this.prisma.notification.findUnique({
      where: { dedupKey },
      select: { id: true },
    });
    if (existing) {
      return false;
    }
    await this.notifications.create(row.userId, {
      kind: NotificationKind.expiring,
      title: expiryTitle(row.amount, row.expiresAt),
      text: EXPIRY_HINT,
      dedupKey,
    });
    return true;
  }
}
