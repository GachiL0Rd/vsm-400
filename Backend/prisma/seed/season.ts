import { brigadeBoardKey, companyBoardKey, depotBoardKey } from '../../src/leaderboard/keys';
import type { SeasonsService } from '../../src/leaderboard/seasons.service';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { RedisService } from '../../src/redis/redis.service';

type Total = {
  points: number;
  brigadeId: string | null;
  depotId: string | null;
};

/**
 * Пока рейсы пишутся, сезон берётся от «сейчас», и в него попадают все недели.
 * После сдвига finishedAt текущая неделя считается заново из Run, ZSET — из SeasonScore.
 */
export async function rebuildCurrentSeason(
  prisma: PrismaService,
  redis: RedisService,
  seasons: SeasonsService,
): Promise<void> {
  const season = await seasons.current();
  const runs = await prisma.run.findMany({
    where: {
      suspicious: false,
      points: { gt: 0 },
      finishedAt: { gte: season.startsAt, lte: season.endsAt },
    },
    select: {
      userId: true,
      points: true,
      user: { select: { brigadeId: true, brigade: { select: { depotId: true } } } },
    },
  });
  const totals = new Map<string, Total>();
  for (const run of runs) {
    const row = totals.get(run.userId) ?? {
      points: 0,
      brigadeId: run.user.brigadeId,
      depotId: run.user.brigade?.depotId ?? null,
    };
    row.points += run.points;
    totals.set(run.userId, row);
  }
  await prisma.seasonScore.deleteMany();
  for (const [userId, row] of totals) {
    await prisma.seasonScore.create({
      data: { seasonId: season.id, userId, points: row.points },
    });
  }
  const keys = await redis.keys(`lb:${season.id}:*`);
  if (keys.length > 0) {
    await redis.del(...keys);
  }
  for (const [userId, row] of totals) {
    if (row.brigadeId) {
      await redis.zadd(brigadeBoardKey(season.id, row.brigadeId), row.points, userId);
    }
    if (row.depotId) {
      await redis.zadd(depotBoardKey(season.id, row.depotId), row.points, userId);
    }
    await redis.zadd(companyBoardKey(season.id), row.points, userId);
  }
  console.log(`Сезон «${season.title}»: ${totals.size} участников в ZSET.`);
}
