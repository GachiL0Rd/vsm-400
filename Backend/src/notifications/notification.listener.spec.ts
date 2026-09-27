import { describe, expect, it, vi } from 'vitest';
import { SystemClock } from '../common/clock';
import { Grade, NotificationKind, Role } from '../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import type { RedisService } from '../redis/redis.service';
import { NotificationListener } from './notification.listener';
import { NotificationsService } from './notifications.service';

type Note = {
  id: string;
  userId: string;
  kind: NotificationKind;
  title: string;
  text: string;
  link: string | null;
  dedupKey: string | null;
  createdAt: Date;
  readAt: Date | null;
};

function harness() {
  const notes: Note[] = [];
  const userQueries: unknown[] = [];
  let seq = 0;
  const users = [
    {
      id: 'conductor',
      callsign: 'A7F3',
      brigadeId: 'brigade-1',
      role: Role.CONDUCTOR,
      disabledAt: null,
    },
    { id: 'chief', callsign: 'K2D9', brigadeId: 'brigade-1', role: Role.CHIEF, disabledAt: null },
  ];
  const runs = [{ id: 'run-9', userId: 'conductor', finishedAt: new Date('2026-09-26T10:00:00Z') }];
  const api = {
    notification: {
      findUnique: async ({ where }: { where: { dedupKey?: string } }) =>
        notes.find((row) => where.dedupKey !== undefined && row.dedupKey === where.dedupKey) ??
        null,
      create: async ({
        data,
      }: {
        data: {
          userId: string;
          kind: NotificationKind;
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
          createdAt: new Date(),
          readAt: null,
        };
        notes.push(row);
        return row;
      },
    },
    run: {
      findFirst: async () => runs[0] ?? null,
    },
    user: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        users.find((user) => user.id === where.id) ?? null,
      findFirst: async ({
        where,
      }: {
        where: { brigadeId?: string; role?: Role; disabledAt?: null };
      }) =>
        users.find(
          (user) =>
            (!where.brigadeId || user.brigadeId === where.brigadeId) &&
            (!where.role || user.role === where.role) &&
            (where.disabledAt !== null || user.disabledAt === null),
        ) ?? null,
      findMany: async ({ where }: { where: unknown }) => {
        userQueries.push(where);
        return users.filter((user) => user.role === Role.CONDUCTOR && user.disabledAt === null);
      },
    },
    scenario: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in
          .filter((id) => id === 'med-chest-pain')
          .map((id) => ({ id, title: 'Пассажиру плохо' })),
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === 'ride-unwell'
          ? {
              id: 'ride-unwell',
              title: 'Пассажиру плохо',
              carClasses: ['BUSINESS'],
              status: 'PUBLISHED',
            }
          : null,
    },
  };
  const prisma = {
    ...api,
    $transaction: async (fn: (tx: typeof api) => Promise<unknown>) => fn(api),
  };
  const notifications = new NotificationsService(
    prisma as unknown as PrismaService,
    { publish: vi.fn(async () => 1) } as unknown as RedisService,
    new SystemClock(),
  );
  const listener = new NotificationListener(prisma as unknown as PrismaService, notifications);
  return { notes, listener, userQueries };
}

describe('слушатели уведомлений', () => {
  it('знак один раз и со ссылкой на разбор, если рейс есть', async () => {
    const { listener, notes } = harness();
    const payload = {
      userId: 'conductor',
      code: 'before-boarding',
      title: 'Журнал без ошибки',
      bonusPoints: 40,
    };
    await listener.onAchievement(payload);
    await listener.onAchievement(payload);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      kind: NotificationKind.achievement,
      title: 'Получен знак «Журнал без ошибки»',
      text: 'Начислено 40 баллов.',
      link: '/runs/run-9',
    });
  });

  it('повышение уходит проводнику и его начальнику', async () => {
    const { listener, notes } = harness();
    await listener.onPromotion({
      recommendationId: 'rec-1',
      userId: 'conductor',
      fromGrade: Grade.CONDUCTOR,
      toGrade: Grade.CONDUCTOR_SENIOR,
    });
    expect(notes.map((row) => [row.userId, row.text])).toEqual([
      ['conductor', 'С «проводник» на «старший проводник».'],
      ['chief', '#A7F3: с «проводник» на «старший проводник».'],
    ]);
  });

  it('назначение сценария', async () => {
    const { listener, notes } = harness();
    await listener.onAssignment({
      assignmentId: 'as-1',
      userId: 'conductor',
      assignedById: 'chief',
      scenarioIds: ['med-chest-pain'],
    });
    expect(notes[0]).toMatchObject({
      kind: NotificationKind.assignment,
      title: 'Назначена смена',
      text: 'Пассажиру плохо',
    });
  });

  it('публикация сценария уходит проводнику с тем же классом вагона один раз', async () => {
    const { listener, notes, userQueries } = harness();
    const payload = { scenarioId: 'ride-unwell', version: 2 };
    await listener.onScenarioPublished(payload);
    await listener.onScenarioPublished(payload);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      userId: 'conductor',
      kind: NotificationKind.scenario,
      title: 'Новый сценарий «Пассажиру плохо»',
      text: 'Пассажиру плохо',
      dedupKey: 'scenario:ride-unwell:v2:conductor',
    });
    expect(userQueries[0]).toEqual({
      role: Role.CONDUCTOR,
      disabledAt: null,
      OR: [
        { runs: { some: { carClass: { in: ['BUSINESS'] } } } },
        { assignedShifts: { some: { carClass: { in: ['BUSINESS'] } } } },
      ],
    });
  });
});
