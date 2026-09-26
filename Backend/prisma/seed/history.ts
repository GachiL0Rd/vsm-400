import type { EventEmitter2 } from '@nestjs/event-emitter';
import { createRng } from '../../src/engine/rng';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { PlayContext } from './content';
import { spreadInstants } from './dates';
import { childSeed, MASTER_SEED } from './master';
import type { ConductorRef } from './org';
import { type SimulatedRun, simulateRun } from './play';
import { planDemo } from './project-demo';
import { recordRun } from './record-run';

type HistoryDeps = {
  prisma: PrismaService;
  events: EventEmitter2;
  seedKey: string;
  ctx: PlayContext;
  now: Date;
};

export async function seedHistory(
  deps: HistoryDeps,
  conductors: readonly ConductorRef[],
): Promise<void> {
  const demo = conductors.find((item) => item.login === 'demo');
  if (!demo) {
    throw new Error('Нет demo среди проводников');
  }
  const planned = planDemo(deps.now, deps.ctx);
  console.log(
    `demo: профиль ${planned.skill}, рейсов ${planned.runs.length}, план очков ${planned.total}`,
  );
  await recordAll(deps, demo.id, planned.runs);
  await assertDemoBand(deps.prisma, demo.id);
  for (const conductor of conductors) {
    if (conductor.login === 'demo') {
      continue;
    }
    await seedConductor(deps, conductor);
  }
  await waitSeasonScores(deps.prisma);
}

async function recordAll(
  deps: HistoryDeps,
  userId: string,
  runs: readonly SimulatedRun[],
): Promise<void> {
  for (const run of runs) {
    await recordRun(deps, userId, run);
  }
}

async function seedConductor(deps: HistoryDeps, conductor: ConductorRef): Promise<void> {
  const userSeed = childSeed(MASTER_SEED, `user:${conductor.login}`);
  const rng = createRng(userSeed);
  const count = rng.int(10, 16);
  const span = rng.int(28, 41);
  const dates = spreadInstants(
    (days) => rng.pick(days),
    () => rng.int(7, 20),
    () => rng.int(0, 59),
    count,
    deps.now,
    span,
  );
  const skill = 0.22 + rng.nextFloat() * 0.7;
  for (let index = 0; index < dates.length; index += 1) {
    const finishedAt = dates[index];
    if (!finishedAt) {
      throw new Error(`Нет даты рейса ${conductor.login}`);
    }
    const run = simulateRun(childSeed(userSeed, `run:${index}`), skill, finishedAt, deps.ctx);
    await recordRun(deps, conductor.id, run);
  }
  console.log(`${conductor.login}: рейсов ${dates.length}`);
}

async function assertDemoBand(prisma: PrismaService, userId: string): Promise<void> {
  const [life, user] = await Promise.all([
    lifetime(prisma, userId),
    prisma.user.findUnique({ where: { id: userId }, select: { streakDays: true } }),
  ]);
  if (life < 2000 || life >= 3000) {
    throw new Error(`Очки demo ${life} вне уровня 7`);
  }
  if (user?.streakDays !== 6) {
    throw new Error(`Серия demo ${user?.streakDays ?? 'нет'}, нужна 6`);
  }
  console.log(`demo после записи: очки ${life}, серия ${user.streakDays}`);
}

async function lifetime(prisma: PrismaService, userId: string): Promise<number> {
  const rows = await prisma.pointLedger.findMany({
    where: { userId, amount: { gt: 0 }, reason: { in: ['RUN', 'ACHIEVEMENT'] } },
    select: { amount: true },
  });
  let sum = 0;
  for (const row of rows) {
    sum += row.amount;
  }
  return sum;
}

/**
 * LeaderboardService пишет SeasonScore без promisify.
 * Ждём, пока сумма сезона догонит сумму очков рейсов, и только потом пересобираем ZSET.
 */
async function waitSeasonScores(prisma: PrismaService): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const [runs, scores, count] = await Promise.all([
      prisma.run.aggregate({ where: { suspicious: false }, _sum: { points: true } }),
      prisma.seasonScore.aggregate({ _sum: { points: true } }),
      prisma.run.count(),
    ]);
    const runPoints = runs._sum.points ?? 0;
    const seasonPoints = scores._sum.points ?? 0;
    if (count > 0 && runPoints === seasonPoints) {
      return;
    }
    await sleep(200);
  }
  throw new Error('SeasonScore не догнал очки рейсов');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
