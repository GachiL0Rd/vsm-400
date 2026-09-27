import type { EventEmitter2 } from '@nestjs/event-emitter';
import { activePoints, nearestExpiry } from '../../src/cabinet/points';
import { ASSIGNMENT_CREATED } from '../../src/common/events';
import { NotificationKind } from '../../src/generated/prisma/client';
import type { NotificationsService } from '../../src/notifications/notifications.service';
import { EXPIRY_HINT, expiryTitle } from '../../src/notifications/ru-format';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { addDays, atMoscow, moscowYmd } from './dates';

const DAY_MS = 86_400_000;
const EXPIRING_POINTS = 120;

type FinishDeps = {
  prisma: PrismaService;
  events: EventEmitter2;
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
 * 120 баллов — ближайшее сгорание, как в кабинете demo.
 * Сумма начислений не меняется: от большого RUN отрезается кусок с более ранним expiresAt.
 */
export async function finishDemo(deps: FinishDeps, demoId: string, chiefId: string): Promise<void> {
  await carveExpiring(deps, demoId);
  await ensureNotices(deps, demoId);
  await assignTomorrow(deps, demoId, chiefId);
}

async function carveExpiring(deps: FinishDeps, demoId: string): Promise<void> {
  const soon = new Date(deps.now.getTime() + 3 * DAY_MS);
  const rows = await deps.prisma.pointLedger.findMany({
    where: { userId: demoId, amount: { gt: 0 }, expiredAt: null },
    orderBy: { amount: 'desc' },
  });
  const host = rows.find((row) => row.amount >= EXPIRING_POINTS);
  if (!host) {
    throw new Error('У demo нет начисления на 120 баллов');
  }
  if (host.amount === EXPIRING_POINTS) {
    await deps.prisma.pointLedger.update({
      where: { id: host.id },
      data: { expiresAt: soon },
    });
  } else {
    await deps.prisma.pointLedger.update({
      where: { id: host.id },
      data: { amount: host.amount - EXPIRING_POINTS },
    });
    await deps.prisma.pointLedger.create({
      data: {
        userId: demoId,
        amount: EXPIRING_POINTS,
        reason: host.reason,
        runId: host.runId,
        createdAt: host.createdAt,
        expiresAt: soon,
      },
    });
  }
  const ledger = await loadLedger(deps.prisma, demoId);
  const expiry = nearestExpiry(ledger, deps.now);
  if (expiry?.points !== EXPIRING_POINTS) {
    throw new Error(`Сгорание demo ${expiry?.points ?? 'нет'}, нужно 120`);
  }
  const notice = await deps.notifications.create(demoId, {
    kind: NotificationKind.expiring,
    title: expiryTitle(EXPIRING_POINTS, soon),
    text: EXPIRY_HINT,
    dedupKey: 'seed:demo:expiring',
  });
  await deps.prisma.notification.update({
    where: { id: notice.id },
    data: { createdAt: new Date(deps.now.getTime() - 2 * 60 * 60 * 1000) },
  });
  console.log(`demo: активные баллы ${activePoints(ledger, deps.now)}, сгорает ${expiry.points}`);
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

async function ensureNotices(deps: FinishDeps, demoId: string): Promise<void> {
  const run = await deps.prisma.run.findFirst({
    where: { userId: demoId },
    orderBy: { finishedAt: 'desc' },
    select: { id: true },
  });
  const drafts: NoticeDraft[] = [
    {
      kind: NotificationKind.advice,
      title: 'Эскалация ниже среднего по депо',
      text: 'В следующем рейсе будет техническая неисправность, о которой нужно доложить.',
      dedupKey: 'seed:demo:advice',
      hoursAgo: 5,
      unread: true,
    },
    {
      kind: NotificationKind.scenario,
      title: 'Добавлены две ситуации',
      text: 'Задымление в тамбуре и пассажир без билета на промежуточной станции.',
      dedupKey: 'seed:demo:scenario',
      hoursAgo: 24,
      unread: true,
    },
    {
      kind: NotificationKind.challenge,
      title: 'Неделя своевременных докладов',
      text: 'Бригады депо соревнуются до воскресенья. Бригада 12 идёт второй из 14.',
      dedupKey: 'seed:demo:challenge',
      hoursAgo: 48,
      unread: false,
    },
    {
      kind: NotificationKind.overtaken,
      title: '#Q81B поднялся на 2-е место в бригаде',
      text: 'Вы на 3-м месте, разница 415 баллов.',
      dedupKey: 'seed:demo:overtaken',
      hoursAgo: 72,
      unread: false,
    },
  ];
  for (const draft of drafts) {
    await putNotice(deps, demoId, draft);
  }
  const earned = await deps.prisma.notification.findFirst({
    where: { userId: demoId, kind: NotificationKind.achievement },
    select: { id: true },
  });
  if (!earned) {
    await putNotice(deps, demoId, {
      kind: NotificationKind.achievement,
      title: 'Получен знак «До посадки»',
      text: 'Табло аварийного выхода найдено на приёмке.',
      dedupKey: 'seed:demo:achievement',
      hoursAgo: 96,
      unread: false,
      ...(run ? { link: `/runs/${run.id}` } : {}),
    });
  }
  // Иначе знаки рейсов с createdAt=now вытесняют challenge со страницы кабинета.
  const aged = new Date(deps.now.getTime() - 8 * DAY_MS);
  await deps.prisma.$executeRaw`
    UPDATE notification
    SET "createdAt" = ${aged}
    WHERE "userId" = CAST(${demoId} AS uuid)
      AND kind::text <> 'assignment'
      AND ("dedupKey" IS NULL OR "dedupKey" NOT LIKE 'seed:demo:%')
  `;
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

async function assignTomorrow(deps: FinishDeps, demoId: string, chiefId: string): Promise<void> {
  const tomorrow = addDays(moscowYmd(deps.now), 1);
  const created = await deps.prisma.shiftAssignment.create({
    data: {
      userId: demoId,
      assignedById: chiefId,
      train: 'ВСМ 707',
      fromStation: 'Москва',
      toStation: 'Санкт-Петербург',
      stops: ['Тверь', 'Бологое'],
      car: 4,
      carClass: 'BUSINESS',
      departureAt: atMoscow(tomorrow, 9, 30),
      focus: ['escalation', 'detection'],
      scenarioIds: ['ride-pressure', 'accept-kit-fault'],
      status: 'PLANNED',
    },
  });
  await deps.events.emitAsync(ASSIGNMENT_CREATED, {
    assignmentId: created.id,
    userId: demoId,
    assignedById: chiefId,
    scenarioIds: created.scenarioIds.slice(),
  });
  await sleep(300);
  const dedupKey = `assignment:${created.id}`;
  const existing = await deps.prisma.notification.findUnique({ where: { dedupKey } });
  if (existing) {
    return;
  }
  await deps.notifications.create(demoId, {
    kind: NotificationKind.assignment,
    title: 'Назначен сценарий',
    text: created.scenarioIds.join(', '),
    dedupKey,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
