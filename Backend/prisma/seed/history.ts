import type { EventEmitter2 } from '@nestjs/event-emitter';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { FinishedGameResult } from '../../src/sessions/platform.dto';
import { personaInstants } from './dates';
import type { ConductorRef } from './org';
import { assignPersonas, type PersonaAssignment } from './personas';
import { recordFixtureRun } from './record-run';

type HistoryDeps = {
  prisma: PrismaService;
  events: EventEmitter2;
  seedKey: string;
  now: Date;
};

export async function seedHistory(
  deps: HistoryDeps,
  conductors: readonly ConductorRef[],
  fixtures: readonly FinishedGameResult[],
): Promise<void> {
  const plans = assignPersonas(fixtures);
  for (const plan of plans) {
    const conductor = conductors.find((item) => item.login === plan.login);
    if (!conductor) {
      throw new Error(`Нет проводника ${plan.login}`);
    }
    await recordPersona(deps, conductor.id, plan, fixtures);
  }
  await waitSeasonScores(deps.prisma);
}

async function recordPersona(
  deps: HistoryDeps,
  userId: string,
  plan: PersonaAssignment,
  fixtures: readonly FinishedGameResult[],
): Promise<void> {
  const dates = personaInstants(deps.now, plan.fixtureIndexes.length, plan.spanDays, plan.streak);
  for (let index = 0; index < plan.fixtureIndexes.length; index += 1) {
    const fixtureIndex = plan.fixtureIndexes[index];
    const fixture = fixtureIndex === undefined ? undefined : fixtures[fixtureIndex];
    const finishedAt = dates[index];
    if (!fixture || !finishedAt) {
      throw new Error(`Нет рейса ${plan.login} #${index}`);
    }
    await recordFixtureRun(deps, userId, fixture, finishedAt);
  }
  console.log(`${plan.login}: рейсов ${plan.fixtureIndexes.length}, позывной ${plan.callsign}`);
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
