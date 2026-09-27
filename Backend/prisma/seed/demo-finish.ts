import { activePoints, nearestExpiry } from '../../src/cabinet/points';
import { NotificationKind } from '../../src/generated/prisma/client';
import type { NotificationsService } from '../../src/notifications/notifications.service';
import { EXPIRY_HINT, expiryTitle } from '../../src/notifications/ru-format';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { addDays, atMoscow, moscowYmd } from './dates';

const DAY_MS = 86_400_000;

type FinishDeps = {
  prisma: PrismaService;
  notifications: NotificationsService;
  now: Date;
};

type NoticeDraft = {
  kind: NotificationKind;
  title: string;
  text: string;
  dedupKey: string;
  hoursAgo: number;
  unread: boolean;
  link?: string;
};

/**
 * Кабинет demo1: ближайшее сгорание — целое начисление за рейс через 3 дня.
 * Сумма баллов не режется: у самого крупного RUN только сдвигается срок.
 */
export async function finishDemo(deps: FinishDeps, userId: string): Promise<void> {
  await carveExpiring(deps, userId);
  await ensureNotices(deps, userId);
  await assignTomorrow(deps, userId);
}

async function carveExpiring(deps: FinishDeps, userId: string): Promise<void> {
  const soon = new Date(deps.now.getTime() + 3 * DAY_MS);
  const rows = await deps.prisma.pointLedger.findMany({
    where: { userId, amount: { gt: 0 }, reason: 'RUN', expiredAt: null },
    orderBy: { amount: 'desc' },
  });
  const host = rows[0];
  if (!host) {
    throw new Error('У demo1 нет начисления за рейс');
  }
  await deps.prisma.pointLedger.update({
    where: { id: host.id },
    data: { expiresAt: soon },
  });
  const ledger = await loadLedger(deps.prisma, userId);
  const expiry = nearestExpiry(ledger, deps.now);
  if (expiry?.points !== host.amount) {
    throw new Error(`Сгорание demo1 ${expiry?.points ?? 'нет'}, нужно ${host.amount}`);
  }
  const notice = await deps.notifications.create(userId, {
    kind: NotificationKind.expiring,
    title: expiryTitle(host.amount, soon),
    text: EXPIRY_HINT,
    dedupKey: 'seed:demo1:expiring',
  });
  await deps.prisma.notification.update({
    where: { id: notice.id },
    data: { createdAt: new Date(deps.now.getTime() - 2 * 60 * 60 * 1000) },
  });
  console.log(`demo1: активные баллы ${activePoints(ledger, deps.now)}, сгорает ${expiry.points}`);
}

async function loadLedger(prisma: PrismaService, userId: string) {
  const rows = await prisma.pointLedger.findMany({
    where: { userId },
    select: { amount: true, reason: true, expiresAt: true, expiredAt: true },
  });
  return rows.map((row) => ({
    amount: row.amount,
    reason: row.reason,
    expiresAt: row.expiresAt,
    expiredAt: row.expiredAt,
  }));
}

async function ensureNotices(deps: FinishDeps, userId: string): Promise<void> {
  const run = await deps.prisma.run.findFirst({
    where: { userId },
    orderBy: { finishedAt: 'desc' },
    select: { id: true },
  });
  const drafts: NoticeDraft[] = [
    {
      kind: NotificationKind.advice,
      title: 'Журнал приёмки',
      text: 'Отмечать неисправность только после осмотра. Ложная отметка снимает вагон с рейса.',
      dedupKey: 'seed:demo1:advice',
      hoursAgo: 5,
      unread: true,
    },
    {
      kind: NotificationKind.scenario,
      title: 'Уровень рейса',
      text: 'Приёмка, посадка, путь: сервис, пожар в салоне и утечка давления.',
      dedupKey: 'seed:demo1:level',
      hoursAgo: 24,
      unread: true,
    },
    {
      kind: NotificationKind.challenge,
      title: 'Неделя бригады 12',
      text: 'До воскресенья считаются потушенные очаги и верные решения о посадке.',
      dedupKey: 'seed:demo1:challenge',
      hoursAgo: 48,
      unread: false,
    },
  ];
  for (const draft of drafts) {
    await putNotice(deps, userId, draft);
  }
  const leader = await brigadeLeader(deps.prisma, userId);
  if (leader) {
    await putNotice(deps, userId, {
      kind: NotificationKind.overtaken,
      title: `#${leader.callsign} впереди в бригаде`,
      text: `Разница ${leader.gap} баллов за текущий сезон.`,
      dedupKey: 'seed:demo1:overtaken',
      hoursAgo: 72,
      unread: false,
    });
  }
  const earned = await deps.prisma.notification.findFirst({
    where: { userId, kind: NotificationKind.achievement },
    select: { id: true },
  });
  if (!earned) {
    await putNotice(deps, userId, {
      kind: NotificationKind.achievement,
      title: 'Знак за рейс',
      text: 'Знак ставится по итогам живого рейса, когда условия выполнены.',
      dedupKey: 'seed:demo1:achievement',
      hoursAgo: 96,
      unread: false,
      ...(run ? { link: `/runs/${run.id}` } : {}),
    });
  }
  const aged = new Date(deps.now.getTime() - 8 * DAY_MS);
  await deps.prisma.$executeRaw`
    UPDATE notification
    SET "createdAt" = ${aged}
    WHERE "userId" = CAST(${userId} AS uuid)
      AND kind::text <> 'assignment'
      AND ("dedupKey" IS NULL OR "dedupKey" NOT LIKE 'seed:demo1:%')
  `;
}

async function brigadeLeader(
  prisma: PrismaService,
  userId: string,
): Promise<{ callsign: string; gap: number } | null> {
  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: { brigadeId: true },
  });
  if (!me?.brigadeId) {
    return null;
  }
  const season = await prisma.season.findFirst({
    orderBy: { startsAt: 'desc' },
    select: { id: true },
  });
  if (!season) {
    return null;
  }
  const rows = await prisma.seasonScore.findMany({
    where: { seasonId: season.id, user: { brigadeId: me.brigadeId } },
    orderBy: { points: 'desc' },
    select: { userId: true, points: true, user: { select: { callsign: true } } },
  });
  const mine = rows.find((row) => row.userId === userId);
  const top = rows.find((row) => row.userId !== userId);
  if (!mine || !top || top.points <= mine.points) {
    return null;
  }
  return { callsign: top.user.callsign, gap: top.points - mine.points };
}

async function putNotice(deps: FinishDeps, userId: string, draft: NoticeDraft): Promise<void> {
  const saved = await deps.notifications.create(userId, {
    kind: draft.kind,
    title: draft.title,
    text: draft.text,
    dedupKey: draft.dedupKey,
    ...(draft.link ? { link: draft.link } : {}),
  });
  const at = new Date(deps.now.getTime() - draft.hoursAgo * 60 * 60 * 1000);
  await deps.prisma.notification.update({
    where: { id: saved.id },
    data: { createdAt: at, readAt: draft.unread ? null : at },
  });
}

async function assignTomorrow(deps: FinishDeps, userId: string): Promise<void> {
  const tomorrow = addDays(moscowYmd(deps.now), 1);
  await deps.prisma.shiftAssignment.create({
    data: {
      userId,
      train: 'ВСМ-001',
      fromStation: 'Москва',
      toStation: 'Санкт-Петербург',
      stops: ['Тверь'],
      car: 1,
      carClass: 'BUSINESS',
      departureAt: atMoscow(tomorrow, 12, 0),
      focus: ['safety', 'service'],
      scenarioIds: [],
      status: 'PLANNED',
    },
  });
}
