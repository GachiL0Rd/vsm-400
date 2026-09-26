import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { NotificationKind, type Prisma } from '../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import type { RedisService } from '../redis/redis.service';
import type { NoticeRow } from './notice';
import { HEARTBEAT_MS, NotificationsService } from './notifications.service';

type Note = NoticeRow & { userId: string; dedupKey: string | null };

function clauses(
  value: Prisma.NotificationWhereInput | Prisma.NotificationWhereInput[] | undefined,
): Prisma.NotificationWhereInput[] {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function sameFields(row: Note, where: Prisma.NotificationWhereInput): boolean {
  if (typeof where.userId === 'string' && row.userId !== where.userId) {
    return false;
  }
  if (typeof where.id === 'string' && row.id !== where.id) {
    return false;
  }
  if (where.kind && row.kind !== where.kind) {
    return false;
  }
  if (typeof where.title === 'string' && row.title !== where.title) {
    return false;
  }
  if (where.link !== undefined && row.link !== where.link) {
    return false;
  }
  return !(where.readAt === null && row.readAt !== null);
}

function sameCursor(row: Note, where: Prisma.NotificationWhereInput): boolean {
  const created = where.createdAt;
  if (created instanceof Date && row.createdAt.getTime() !== created.getTime()) {
    return false;
  }
  if (created && typeof created === 'object' && 'lt' in created && created.lt instanceof Date) {
    if (!(row.createdAt < created.lt)) {
      return false;
    }
  }
  const idFilter = where.id;
  if (
    idFilter &&
    typeof idFilter === 'object' &&
    'lt' in idFilter &&
    typeof idFilter.lt === 'string'
  ) {
    return row.id < idFilter.lt;
  }
  return true;
}

function match(row: Note, where: Prisma.NotificationWhereInput): boolean {
  const or = clauses(where.OR);
  if (or.length > 0) {
    return or.some((branch) => match(row, { ...where, OR: undefined, ...branch }));
  }
  const and = clauses(where.AND);
  if (and.length > 0) {
    return and.every((branch) => match(row, branch));
  }
  return sameFields(row, where) && sameCursor(row, where);
}

function memory() {
  const notes: Note[] = [];
  let seq = 0;
  const published: { channel: string; message: string }[] = [];
  const api = {
    notification: {
      findFirst: async ({ where }: { where: Prisma.NotificationWhereInput }) =>
        notes.find((row) => match(row, where)) ?? null,
      findUnique: async ({ where }: { where: { dedupKey?: string; id?: string } }) =>
        notes.find(
          (row) =>
            (where.dedupKey !== undefined && row.dedupKey === where.dedupKey) ||
            (where.id !== undefined && row.id === where.id),
        ) ?? null,
      findMany: async ({
        where,
        take,
      }: {
        where: Prisma.NotificationWhereInput;
        take?: number;
      }) => {
        const rows = notes
          .filter((row) => match(row, where))
          .sort((left, right) => {
            const byTime = right.createdAt.getTime() - left.createdAt.getTime();
            if (byTime !== 0) {
              return byTime;
            }
            if (left.id < right.id) {
              return 1;
            }
            return -1;
          });
        return take === undefined ? rows : rows.slice(0, take);
      },
      create: async ({
        data,
      }: {
        data: {
          userId: string;
          kind: Note['kind'];
          title: string;
          text: string;
          link?: string;
          dedupKey?: string;
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
          dedupKey: data.dedupKey ?? null,
          createdAt: new Date(Date.UTC(2026, 8, 26, 12, seq)),
          readAt: null,
        };
        notes.push(row);
        return row;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: Prisma.NotificationWhereInput;
        data: { readAt: Date };
      }) => {
        let count = 0;
        for (const row of notes) {
          if (match(row, where)) {
            row.readAt = data.readAt;
            count += 1;
          }
        }
        return { count };
      },
      count: async ({ where }: { where: Prisma.NotificationWhereInput }) =>
        notes.filter((row) => match(row, where)).length,
    },
  };
  const prisma = {
    ...api,
    $transaction: async (fn: (tx: typeof api) => Promise<unknown>) => fn(api),
  };
  const redis = {
    publish: vi.fn(async (channel: string, message: string) => {
      published.push({ channel, message });
      return 1;
    }),
  };
  const service = new NotificationsService(
    prisma as unknown as PrismaService,
    redis as unknown as RedisService,
  );
  return { notes, published, service };
}

describe('NotificationsService', () => {
  it('SSE отдаёт new-notification и не дублирует своё redis-эхо', async () => {
    const { service, published } = memory();
    const events: { type?: string; data?: unknown }[] = [];
    const subscription = service.stream('user-1').subscribe((event) => {
      events.push(event);
    });
    const notice = await service.create('user-1', {
      kind: NotificationKind.advice,
      title: 'Смена',
      text: 'Текст',
      link: '/shifts/1',
    });
    expect(notice.link).toBe('/shifts/1');
    expect(events.some((event) => event.type === 'new-notification' && event.data === notice)).toBe(
      true,
    );
    expect(published[0]?.channel).toBe('vsm:notify:user-1');
    const before = events.length;
    service.deliverRemote('vsm:notify:user-1', JSON.stringify(notice));
    expect(events).toHaveLength(before);
    service.deliverRemote(
      'vsm:notify:user-1',
      JSON.stringify({ ...notice, id: 'foreign', title: 'Чужое' }),
    );
    expect(events).toHaveLength(before + 1);
    expect(events.at(-1)?.type).toBe('new-notification');
    subscription.unsubscribe();
  });

  it('heartbeat раз в 25 секунд', () => {
    vi.useFakeTimers();
    const { service } = memory();
    const events: { type?: string }[] = [];
    const subscription = service.stream('user-1').subscribe((event) => {
      events.push(event);
    });
    vi.advanceTimersByTime(HEARTBEAT_MS);
    expect(events.some((event) => event.type === 'heartbeat')).toBe(true);
    subscription.unsubscribe();
    vi.useRealTimers();
  });

  it('повтор dedupKey не создаёт вторую запись', async () => {
    const { service, notes, published } = memory();
    const draft = {
      kind: NotificationKind.assignment,
      title: 'Назначен сценарий',
      text: 'med',
      dedupKey: 'assignment:a1',
    };
    await service.create('user-1', draft);
    await service.create('user-1', draft);
    expect(notes).toHaveLength(1);
    expect(published).toHaveLength(1);
  });

  it('листает ленту, считает непрочитанные и помечает прочитанным', async () => {
    const { service } = memory();
    await service.create('user-1', { kind: NotificationKind.advice, title: '1', text: 'a' });
    await service.create('user-1', { kind: NotificationKind.advice, title: '2', text: 'b' });
    await service.create('user-1', { kind: NotificationKind.advice, title: '3', text: 'c' });
    const first = await service.list('user-1', 2);
    expect(first.unreadCount).toBe(3);
    expect(first.items.map((item) => item.title)).toEqual(['3', '2']);
    expect(first.nextCursor).toBeTypeOf('string');
    const second = await service.list('user-1', 2, first.nextCursor ?? undefined);
    expect(second.items.map((item) => item.title)).toEqual(['1']);
    expect(second.nextCursor).toBeNull();

    const read = await service.markRead('user-1', first.items[0]?.id ?? '');
    expect(read.unread).toBe(false);
    expect((await service.list('user-1', 10)).unreadCount).toBe(2);
    expect(await service.markAllRead('user-1')).toEqual({ unreadCount: 0 });
    await expect(service.markRead('user-1', 'missing')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.list('user-1', 10, '@@@')).rejects.toBeInstanceOf(BadRequestException);
  });
});
