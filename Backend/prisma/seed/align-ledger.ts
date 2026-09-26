import type { PrismaService } from '../../src/prisma/prisma.service';

const TTL_MS = 30 * 86_400_000;

type Grant = {
  id: string;
  runId: string;
};

type OpenGrant = {
  id: string;
  expiresAt: Date;
  dead: boolean;
};

/**
 * RunRecorder и ачивки берут expiresAt/earnedAt от new Date(), не от конца рейса.
 * Часов в сервисах нет. После записи сдвигаем createdAt к finishedAt и
 * проигрываем то же правило: каждый рейс продлевает ещё живые начисления на 30 суток.
 */
export async function alignLedger(prisma: PrismaService): Promise<void> {
  await shiftEarnedAt(prisma);
  await prisma.$executeRaw`
    UPDATE point_ledger AS pl
    SET "createdAt" = r."finishedAt"
    FROM run AS r
    WHERE pl."runId" = r.id
  `;
  const users = await prisma.user.findMany({ select: { id: true } });
  for (const user of users) {
    await shiftUserExpiry(prisma, user.id);
  }
}

async function shiftEarnedAt(prisma: PrismaService): Promise<void> {
  const [badges, grants, runs] = await Promise.all([
    prisma.userAchievement.findMany({
      where: { earnedAt: { not: null } },
      orderBy: [{ userId: 'asc' }, { earnedAt: 'asc' }, { code: 'asc' }],
    }),
    prisma.pointLedger.findMany({
      where: { reason: 'ACHIEVEMENT', runId: { not: null } },
      orderBy: [{ userId: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      select: { userId: true, runId: true },
    }),
    prisma.run.findMany({ select: { id: true, finishedAt: true } }),
  ]);
  const finished = new Map(runs.map((run) => [run.id, run.finishedAt]));
  const byUser = groupGrants(grants);
  const cursor = new Map<string, number>();
  for (const badge of badges) {
    const list = byUser.get(badge.userId) ?? [];
    const index = cursor.get(badge.userId) ?? 0;
    cursor.set(badge.userId, index + 1);
    const grant = list[index];
    const at = grant ? finished.get(grant.runId) : undefined;
    if (!at) {
      continue;
    }
    await prisma.userAchievement.update({
      where: { userId_code: { userId: badge.userId, code: badge.code } },
      data: { earnedAt: at },
    });
  }
}

function groupGrants(
  grants: readonly { userId: string; runId: string | null }[],
): Map<string, { runId: string }[]> {
  const grouped = new Map<string, { runId: string }[]>();
  for (const grant of grants) {
    if (!grant.runId) {
      continue;
    }
    const list = grouped.get(grant.userId) ?? [];
    list.push({ runId: grant.runId });
    grouped.set(grant.userId, list);
  }
  return grouped;
}

async function shiftUserExpiry(prisma: PrismaService, userId: string): Promise<void> {
  const [runs, rows] = await Promise.all([
    prisma.run.findMany({
      where: { userId },
      orderBy: { finishedAt: 'asc' },
      select: { id: true, finishedAt: true },
    }),
    prisma.pointLedger.findMany({
      where: { userId, amount: { gt: 0 }, expiredAt: null, runId: { not: null } },
      select: { id: true, runId: true },
    }),
  ]);
  const byRun = new Map<string, Grant[]>();
  for (const row of rows) {
    if (!row.runId) {
      continue;
    }
    const list = byRun.get(row.runId) ?? [];
    list.push({ id: row.id, runId: row.runId });
    byRun.set(row.runId, list);
  }
  const open: OpenGrant[] = [];
  for (const run of runs) {
    closeExpired(open, run.finishedAt);
    const born = byRun.get(run.id) ?? [];
    const expiresAt = new Date(run.finishedAt.getTime() + TTL_MS);
    for (const grant of born) {
      open.push({ id: grant.id, expiresAt, dead: false });
    }
    extendLive(open, expiresAt);
    if (born.length > 0) {
      await prisma.pointLedger.updateMany({
        where: { id: { in: born.map((grant) => grant.id) } },
        data: { createdAt: run.finishedAt },
      });
    }
  }
  for (const grant of open) {
    await prisma.pointLedger.update({
      where: { id: grant.id },
      data: { expiresAt: grant.expiresAt },
    });
  }
}

function closeExpired(open: OpenGrant[], at: Date): void {
  for (const grant of open) {
    if (!grant.dead && grant.expiresAt.getTime() <= at.getTime()) {
      grant.dead = true;
    }
  }
}

function extendLive(open: OpenGrant[], expiresAt: Date): void {
  for (const grant of open) {
    if (!grant.dead) {
      grant.expiresAt = expiresAt;
    }
  }
}
