import { describe, expect, it, vi } from 'vitest';
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
  createdAt: Date;
  readAt: Date | null;
};

function harness() {
  const notes: Note[] = [];
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
      findFirst: async ({
        where,
      }: {
        where: { userId?: string; kind?: NotificationKind; title?: string; link?: string };
      }) =>
        notes.find(
          (row) =>
            (!where.userId || row.userId === where.userId) &&
            (!where.kind || row.kind === where.kind) &&
            (!where.title || row.title === where.title) &&
            (where.link === undefined || row.link === where.link),
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
  const listener = new NotificationListener(prisma as unknown as PrismaService, notifications);
  return { notes, listener };
}

describe('слушатели уведомлений', () => {
  it('знак один раз и со ссылкой на разбор, если рейс есть', async () => {
    const { listener, notes } = harness();
    const payload = {
      userId: 'conductor',
      code: 'before-boarding',
      title: 'До посадки',
      bonusPoints: 40,
    };
    await listener.onAchievement(payload);
    await listener.onAchievement(payload);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      kind: NotificationKind.achievement,
      title: 'Получен знак «До посадки»',
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
      title: 'Назначен сценарий',
      text: 'med-chest-pain',
    });
  });
});
