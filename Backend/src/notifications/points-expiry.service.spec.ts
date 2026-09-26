import { describe, expect, it, vi } from 'vitest';
import { LedgerReason, NotificationKind } from '../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import type { RedisService } from '../redis/redis.service';
import type { RulesService } from '../rules/rules.service';
import { NotificationsService } from './notifications.service';
import { PointsExpiryService } from './points-expiry.service';
import { EXPIRY_HINT } from './ru-format';

type Ledger = {
  id: string;
  userId: string;
  amount: number;
  reason: LedgerReason;
  runId: string | null;
  expiresAt: Date | null;
  expiredAt: Date | null;
};

type Note = {
  id: string;
  userId: string;
  kind: NotificationKind;
  title: string;
  text: string;
  link: string | null;
  createdAt: Date;
  readAt: Date | null;
};

type ExpiryWhere = {
  expiredAt?: null;
  amount?: { gt?: number };
  expiresAt?: { lt?: Date; gt?: Date; lte?: Date };
  id?: string;
};

function matchesLedger(row: Ledger, where: ExpiryWhere): boolean {
  if (where.id && row.id !== where.id) {
    return false;
  }
  if (where.expiredAt === null && row.expiredAt !== null) {
    return false;
  }
  if (where.amount?.gt !== undefined && !(row.amount > where.amount.gt)) {
    return false;
  }
  const expires = where.expiresAt;
  if (expires?.lt && !(row.expiresAt && row.expiresAt < expires.lt)) {
    return false;
  }
  if (expires?.gt && !(row.expiresAt && row.expiresAt > expires.gt)) {
    return false;
  }
  if (expires?.lte && !(row.expiresAt && row.expiresAt <= expires.lte)) {
    return false;
  }
  return true;
}

function harness() {
  const ledger: Ledger[] = [];
  const notes: Note[] = [];
  let seq = 0;
  const api = {
    pointLedger: {
      findMany: async ({ where }: { where: ExpiryWhere }) =>
        ledger.filter((row) => matchesLedger(row, where)),
      updateMany: async ({ where, data }: { where: ExpiryWhere; data: { expiredAt: Date } }) => {
        let count = 0;
        for (const row of ledger) {
          if (matchesLedger(row, where)) {
            row.expiredAt = data.expiredAt;
            count += 1;
          }
        }
        return { count };
      },
      create: async ({
        data,
      }: {
        data: {
          userId: string;
          amount: number;
          reason: LedgerReason;
          runId: string | null;
          expiredAt?: Date;
        };
      }) => {
        seq += 1;
        const row: Ledger = {
          id: `l${seq}`,
          userId: data.userId,
          amount: data.amount,
          reason: data.reason,
          runId: data.runId,
          expiresAt: null,
          expiredAt: data.expiredAt ?? null,
        };
        ledger.push(row);
        return row;
      },
    },
    notification: {
      findFirst: async ({
        where,
      }: {
        where: { userId?: string; link?: string; kind?: NotificationKind };
      }) =>
        notes.find(
          (row) =>
            (!where.userId || row.userId === where.userId) &&
            (where.link === undefined || row.link === where.link) &&
            (!where.kind || row.kind === where.kind),
        ) ?? null,
      create: async ({
        data,
      }: {
        data: {
          userId: string;
          kind: NotificationKind;
          title: string;
          text: string;
          link?: string;
        };
      }) => {
        seq += 1;
        const row: Note = {
          id: `n${seq}`,
          userId: data.userId,
          kind: data.kind,
          title: data.title,
          text: data.text,
          link: data.link ?? null,
          createdAt: new Date(),
          readAt: null,
        };
        notes.push(row);
        return row;
      },
    },
  };
  const prisma = {
    ...api,
    $transaction: async (fn: (tx: typeof api) => Promise<unknown>) => fn(api),
  };
  const notifications = new NotificationsService(
    prisma as unknown as PrismaService,
    { publish: vi.fn(async () => 1) } as unknown as RedisService,
  );
  const rules = { expiryWarnDays: () => 3 } as unknown as RulesService;
  const service = new PointsExpiryService(prisma as unknown as PrismaService, rules, notifications);
  return { ledger, notes, service };
}

const now = new Date('2026-09-26T12:00:00+03:00');

describe('сгорание баллов', () => {
  it('пишет один EXPIRE и второй проход ничего не меняет', async () => {
    const { ledger, service } = harness();
    ledger.push({
      id: 'accrual',
      userId: 'user-1',
      amount: 120,
      reason: LedgerReason.RUN,
      runId: 'run-1',
      expiresAt: new Date('2026-09-26T11:00:00+03:00'),
      expiredAt: null,
    });
    expect((await service.expireDue(now)).expired).toBe(1);
    expect((await service.expireDue(now)).expired).toBe(0);
    const burned = ledger.filter((row) => row.reason === LedgerReason.EXPIRE);
    expect(burned).toHaveLength(1);
    expect(burned[0]).toMatchObject({ amount: -120, userId: 'user-1', runId: 'run-1' });
    expect(ledger[0]?.expiredAt).toEqual(now);
  });

  it('предупреждает один раз и только внутри окна', async () => {
    const { ledger, notes, service } = harness();
    ledger.push(
      {
        id: 'soon',
        userId: 'user-1',
        amount: 120,
        reason: LedgerReason.RUN,
        runId: null,
        expiresAt: new Date('2026-09-29T09:00:00+03:00'),
        expiredAt: null,
      },
      {
        id: 'later',
        userId: 'user-1',
        amount: 50,
        reason: LedgerReason.RUN,
        runId: null,
        expiresAt: new Date('2026-10-20T09:00:00+03:00'),
        expiredAt: null,
      },
    );
    expect((await service.expireDue(now)).warned).toBe(1);
    expect((await service.expireDue(now)).warned).toBe(0);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      kind: NotificationKind.expiring,
      title: '120 баллов спишутся 29 сентября',
      text: EXPIRY_HINT,
    });
    expect(notes[0]?.link).toBe('vsm:ledger:soon');
  });
});
