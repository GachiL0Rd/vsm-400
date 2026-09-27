import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Cron } from '@nestjs/schedule';
import type { AuthUser } from '../auth/auth-user';
import { Clock } from '../common/clock';
import { acquireCronLock, cronWindow } from '../common/cron-lock';
import { RUN_RECORDED, type RunRecordedPayload } from '../common/events';
import { NotificationKind, type Season } from '../generated/prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { pointsWord } from '../notifications/ru-format';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import {
  type BoardMember,
  type Leaderboard,
  type LeaderRow,
  moveOf,
  overtakenBy,
  parseWithScores,
  presentRow,
  rankBrigade,
  rankScored,
  type ScoredMember,
  topAndViewer,
} from './board';
import {
  appliedRunKey,
  type BoardScope,
  boardKey,
  brigadeBoardKey,
  companyBoardKey,
  depotBoardKey,
  isBoardScope,
  snapKey,
} from './keys';
import { seasonWindow } from './season-window';
import { SeasonsService } from './seasons.service';

/** Дольше сезона и срока баллов: повтор run.recorded не должен доначислить. */
const APPLIED_TTL_SEC = 40 * 24 * 60 * 60;
const CRON_SLOT_TTL_MS = 30 * 60_000;

type ScoreFilter = {
  brigadeId?: string;
  depotId?: string;
};

type BrigadeTotal = {
  brigadeId: string;
  name: string;
  points: number;
};

@Injectable()
export class LeaderboardService {
  private readonly logger = new Logger(LeaderboardService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(SeasonsService) private readonly seasons: SeasonsService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  // suppressErrors: false — сбой Redis не должен ставить effectsAt, cron повторит.
  @OnEvent(RUN_RECORDED, { async: true, promisify: true, suppressErrors: false })
  async onRunRecorded(payload: RunRecordedPayload): Promise<void> {
    const key = appliedRunKey(payload.runId);
    const skip = payload.suspicious || payload.points <= 0;
    const gate = await this.redis.set(key, skip ? 'skip' : 'pending', 'EX', APPLIED_TTL_SEC, 'NX');
    if (gate !== 'OK' || skip) {
      return;
    }
    try {
      await this.applyRecorded(payload);
    } catch (error) {
      await this.redis.del(key);
      throw error;
    }
  }

  /** Пн 00:00 МСК закрывает предыдущую неделю, не ту, что только началась. */
  @Cron('0 0 * * 1', {
    name: 'social-season-close',
    timeZone: 'Europe/Moscow',
    waitForCompletion: true,
  })
  async closeSeasonJob(): Promise<void> {
    const now = this.clock.now();
    const locked = await acquireCronLock(
      this.redis,
      'social-season-close',
      cronWindow(now, 'day'),
      CRON_SLOT_TTL_MS,
    );
    if (!locked) {
      return;
    }
    await this.closeSeason(now);
  }

  async closeSeason(at?: Date): Promise<void> {
    const now = at ?? this.clock.now();
    const current = seasonWindow(now);
    const previous = seasonWindow(new Date(current.startsAt.getTime() - 1));
    const season = await this.prisma.season.findFirst({ where: { startsAt: previous.startsAt } });
    if (!season) {
      return;
    }
    const top = await this.topBrigades(season.id);
    for (let index = 0; index < top.length; index += 1) {
      const place = top[index];
      if (place) {
        await this.notifyBrigadePlace(season, place, index + 1);
      }
    }
  }

  /** 00:05 МСК. Ранги те же, что на выдаче, иначе move врёт на нулях бригады. */
  @Cron('5 0 * * *', {
    name: 'social-leaderboard-snap',
    timeZone: 'Europe/Moscow',
    waitForCompletion: true,
  })
  async snapshotRanksJob(): Promise<void> {
    const now = this.clock.now();
    const locked = await acquireCronLock(
      this.redis,
      'social-leaderboard-snap',
      cronWindow(now, 'day'),
      CRON_SLOT_TTL_MS,
    );
    if (!locked) {
      return;
    }
    await this.snapshotRanks(now);
  }

  async snapshotRanks(at?: Date): Promise<void> {
    const now = at ?? this.clock.now();
    const season = await this.seasons.current(now);
    const brigades = await this.prisma.brigade.findMany({ select: { id: true } });
    for (const brigade of brigades) {
      await this.storeSnap(season, 'brigade', brigade.id);
    }
    const depots = await this.prisma.depot.findMany({ select: { id: true } });
    for (const depot of depots) {
      await this.storeSnap(season, 'depot', depot.id);
    }
    await this.storeSnap(season, 'company', null);
  }

  async board(user: AuthUser, scope: string, seasonId?: string): Promise<Leaderboard> {
    if (!isBoardScope(scope)) {
      throw notFound('Неизвестный рейтинг', 'LEADERBOARD_SCOPE');
    }
    const season = await this.resolveSeason(seasonId);
    if (scope === 'brigade' && !user.brigadeId) {
      return emptyBoard(season);
    }
    const scopeId = this.scopeId(user, scope);
    const ranked = await this.ranked(season, scope, scopeId);
    const shifts = await this.moves(season.id, scope, scopeId, ranked);
    const withMove = ranked.map((row) => ({
      userId: row.userId,
      callsign: row.callsign,
      points: row.points,
      rank: row.rank,
      move: shifts.get(row.userId) ?? 0,
    }));
    const visible = scope === 'brigade' ? withMove : topAndViewer(withMove, user.id);
    const rows: LeaderRow[] = [];
    for (const row of visible) {
      rows.push(presentRow(row, user.id));
    }
    return {
      seasonId: season.id,
      season: season.title,
      endsAt: season.endsAt.toISOString(),
      total: withMove.length,
      rows,
    };
  }

  async brigadePlace(user: AuthUser): Promise<{ rank: number | null; total: number }> {
    if (!user.brigadeId) {
      return { rank: null, total: 0 };
    }
    const depotId = user.depotId ?? (await this.depotIdOf(user.brigadeId));
    if (!depotId) {
      throw notFound('У бригады нет депо', 'NO_DEPOT');
    }
    const season = await this.seasons.current();
    const totals = await this.brigadeTotals(season.id, depotId);
    const index = totals.findIndex((row) => row.brigadeId === user.brigadeId);
    if (index < 0) {
      throw notFound('Бригада не в депо', 'NO_BRIGADE');
    }
    return { rank: index + 1, total: totals.length };
  }

  private async applyRecorded(payload: RunRecordedPayload): Promise<void> {
    const season = await this.seasons.current();
    const brigadeKey = payload.brigadeId ? brigadeBoardKey(season.id, payload.brigadeId) : null;
    const before = brigadeKey
      ? await this.readBoard(brigadeKey, season.id, { brigadeId: payload.brigadeId ?? undefined })
      : [];
    const oldPoints = pointsOf(before, payload.userId);
    const touched = await this.bumpBoards(payload, season.id);
    try {
      await this.prisma.seasonScore.upsert({
        where: { seasonId_userId: { seasonId: season.id, userId: payload.userId } },
        create: { seasonId: season.id, userId: payload.userId, points: payload.points },
        update: { points: { increment: payload.points } },
      });
    } catch (error) {
      await this.undoBump(touched, payload);
      throw error;
    }
    if (!brigadeKey) {
      return;
    }
    try {
      await this.notifyOvertaken(payload, brigadeKey, before, oldPoints);
    } catch (error) {
      this.logger.error(error instanceof Error ? error.message : String(error));
    }
  }

  private async bumpBoards(payload: RunRecordedPayload, seasonId: string): Promise<string[]> {
    const touched: string[] = [];
    if (payload.brigadeId) {
      const key = brigadeBoardKey(seasonId, payload.brigadeId);
      await this.redis.zincrby(key, payload.points, payload.userId);
      touched.push(key);
    }
    if (payload.depotId) {
      const key = depotBoardKey(seasonId, payload.depotId);
      await this.rebuildIfEmpty(key, seasonId, { depotId: payload.depotId });
      await this.redis.zincrby(key, payload.points, payload.userId);
      touched.push(key);
    }
    const company = companyBoardKey(seasonId);
    await this.rebuildIfEmpty(company, seasonId, {});
    await this.redis.zincrby(company, payload.points, payload.userId);
    touched.push(company);
    return touched;
  }

  private async undoBump(keys: string[], payload: RunRecordedPayload): Promise<void> {
    for (const key of keys) {
      await this.redis.zincrby(key, -payload.points, payload.userId);
    }
  }

  private async readBoard(
    key: string,
    seasonId: string,
    filter: ScoreFilter,
  ): Promise<ScoredMember[]> {
    await this.rebuildIfEmpty(key, seasonId, filter);
    return parseWithScores(await this.redis.zrevrange(key, 0, -1, 'WITHSCORES'));
  }

  /**
   * Пустой ZSET после сброса Redis нельзя наполнять одним ZINCRBY:
   * ключ станет непустым и остальные SeasonScore уже не восстановить.
   */
  private async rebuildIfEmpty(key: string, seasonId: string, filter: ScoreFilter): Promise<void> {
    if ((await this.redis.zcard(key)) > 0) {
      return;
    }
    const rows = await this.scoreRows(seasonId, filter);
    if ((await this.redis.zcard(key)) > 0) {
      return;
    }
    for (const row of rows) {
      await this.redis.zadd(key, row.points, row.userId);
    }
  }

  private async scoreRows(seasonId: string, filter: ScoreFilter): Promise<ScoredMember[]> {
    if (filter.brigadeId) {
      return this.prisma.seasonScore.findMany({
        where: { seasonId, points: { gt: 0 }, user: { brigadeId: filter.brigadeId } },
        select: { userId: true, points: true },
      });
    }
    if (filter.depotId) {
      return this.prisma.seasonScore.findMany({
        where: {
          seasonId,
          points: { gt: 0 },
          user: { brigade: { depotId: filter.depotId } },
        },
        select: { userId: true, points: true },
      });
    }
    return this.prisma.seasonScore.findMany({
      where: { seasonId, points: { gt: 0 } },
      select: { userId: true, points: true },
    });
  }

  private async notifyOvertaken(
    payload: RunRecordedPayload,
    key: string,
    before: ScoredMember[],
    oldPoints: number,
  ): Promise<void> {
    const newPoints = oldPoints + payload.points;
    const passed = overtakenBy(before, payload.userId, oldPoints, newPoints);
    if (passed.length === 0) {
      return;
    }
    const actor = await this.prisma.user.findUnique({
      where: { id: payload.userId },
      select: { callsign: true },
    });
    if (!actor) {
      return;
    }
    const actorRank = await this.rankOf(key, payload.userId);
    if (actorRank === null) {
      return;
    }
    for (const other of passed) {
      await this.notifyOneOvertaken(payload, key, actor.callsign, actorRank, newPoints, other);
    }
  }

  private async notifyOneOvertaken(
    payload: RunRecordedPayload,
    key: string,
    callsign: string,
    actorRank: number,
    newPoints: number,
    other: ScoredMember,
  ): Promise<void> {
    const theirRank = await this.rankOf(key, other.userId);
    if (theirRank === null) {
      return;
    }
    const diff = newPoints - other.points;
    await this.notifications.create(other.userId, {
      kind: NotificationKind.overtaken,
      title: `#${callsign} поднялся на ${actorRank}-е место в бригаде`,
      text: `Вы на ${theirRank}-м месте, разница ${diff} ${pointsWord(diff)}.`,
      dedupKey: `overtaken:${payload.runId}:${other.userId}`,
    });
  }

  private async rankOf(key: string, userId: string): Promise<number | null> {
    const rank = await this.redis.zrevrank(key, userId);
    if (rank === null) {
      return null;
    }
    return rank + 1;
  }

  private async ranked(
    season: Season,
    scope: BoardScope,
    scopeId: string | null,
  ): Promise<BoardMember[]> {
    if (scope === 'brigade') {
      return this.rankedBrigade(season.id, scopeId ?? '');
    }
    const key =
      scope === 'depot' ? depotBoardKey(season.id, scopeId ?? '') : companyBoardKey(season.id);
    const filter: ScoreFilter = scope === 'depot' ? { depotId: scopeId ?? '' } : {};
    await this.rebuildIfEmpty(key, season.id, filter);
    const scored = parseWithScores(await this.redis.zrevrange(key, 0, -1, 'WITHSCORES'));
    const ids = scored.map((row) => row.userId);
    if (ids.length === 0) {
      return [];
    }
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, callsign: true },
    });
    return rankScored(scored, new Map(users.map((user) => [user.id, user.callsign])));
  }

  private async rankedBrigade(seasonId: string, brigadeId: string): Promise<BoardMember[]> {
    const key = brigadeBoardKey(seasonId, brigadeId);
    await this.rebuildIfEmpty(key, seasonId, { brigadeId });
    const scores = new Map<string, number>();
    for (const row of parseWithScores(await this.redis.zrevrange(key, 0, -1, 'WITHSCORES'))) {
      scores.set(row.userId, row.points);
    }
    const members = await this.prisma.user.findMany({
      where: { brigadeId },
      select: { id: true, callsign: true },
    });
    return rankBrigade(members, scores);
  }

  private async moves(
    seasonId: string,
    scope: BoardScope,
    scopeId: string | null,
    rows: BoardMember[],
  ): Promise<Map<string, number>> {
    const saved = await this.redis.hgetall(snapKey(boardKey(seasonId, scope, scopeId)));
    const shifts = new Map<string, number>();
    for (const row of rows) {
      shifts.set(row.userId, moveOf(previousRank(saved[row.userId]), row.rank));
    }
    return shifts;
  }

  private async storeSnap(
    season: Season,
    scope: BoardScope,
    scopeId: string | null,
  ): Promise<void> {
    const ranked = await this.ranked(season, scope, scopeId);
    const key = snapKey(boardKey(season.id, scope, scopeId));
    await this.redis.del(key);
    if (ranked.length === 0) {
      return;
    }
    const payload: Record<string, string> = {};
    for (const row of ranked) {
      payload[row.userId] = String(row.rank);
    }
    await this.redis.hset(key, payload);
  }

  private async resolveSeason(seasonId?: string): Promise<Season> {
    if (!seasonId) {
      return this.seasons.current();
    }
    const season = await this.prisma.season.findUnique({ where: { id: seasonId } });
    if (!season) {
      throw notFound('Сезон не найден', 'SEASON_NOT_FOUND');
    }
    return season;
  }

  private scopeId(user: AuthUser, scope: BoardScope): string | null {
    if (scope === 'company') {
      return null;
    }
    if (scope === 'brigade') {
      if (!user.brigadeId) {
        throw notFound('Пользователь не в бригаде', 'NO_BRIGADE');
      }
      return user.brigadeId;
    }
    if (!user.depotId) {
      throw notFound('Пользователь не в депо', 'NO_DEPOT');
    }
    return user.depotId;
  }

  private async depotIdOf(brigadeId: string): Promise<string | null> {
    const brigade = await this.prisma.brigade.findUnique({
      where: { id: brigadeId },
      select: { depotId: true },
    });
    return brigade?.depotId ?? null;
  }

  private async topBrigades(seasonId: string): Promise<BrigadeTotal[]> {
    const totals = await this.brigadeTotals(seasonId, null);
    const placed = totals.filter((row) => row.points > 0);
    return placed.slice(0, 3);
  }

  private async brigadeTotals(seasonId: string, depotId: string | null): Promise<BrigadeTotal[]> {
    const brigades = await this.prisma.brigade.findMany({
      where: depotId ? { depotId } : undefined,
      select: { id: true, name: true },
    });
    const scores = await this.scoreRowsForTotals(seasonId, depotId);
    const totals = new Map<string, number>();
    const names = new Map<string, string>();
    for (const brigade of brigades) {
      totals.set(brigade.id, 0);
      names.set(brigade.id, brigade.name);
    }
    for (const row of scores) {
      const brigadeId = row.brigadeId;
      if (!brigadeId || !totals.has(brigadeId)) {
        continue;
      }
      totals.set(brigadeId, (totals.get(brigadeId) ?? 0) + row.points);
    }
    const ordered: BrigadeTotal[] = [];
    for (const [brigadeId, points] of totals) {
      ordered.push({ brigadeId, name: names.get(brigadeId) ?? '', points });
    }
    ordered.sort(byBrigadePoints);
    return ordered;
  }

  private async scoreRowsForTotals(
    seasonId: string,
    depotId: string | null,
  ): Promise<{ brigadeId: string | null; points: number }[]> {
    const rows = await this.prisma.seasonScore.findMany({
      where: depotId ? { seasonId, user: { brigade: { depotId } } } : { seasonId },
      select: { points: true, user: { select: { brigadeId: true } } },
    });
    return rows.map((row) => ({ brigadeId: row.user.brigadeId, points: row.points }));
  }

  private async notifyBrigadePlace(
    season: Season,
    place: BrigadeTotal,
    rank: number,
  ): Promise<void> {
    const members = await this.prisma.user.findMany({
      where: { brigadeId: place.brigadeId },
      select: { id: true },
    });
    for (const member of members) {
      await this.notifications.create(member.id, {
        kind: NotificationKind.challenge,
        title: `${season.title} завершён`,
        text: `Бригада «${place.name}» заняла ${rank}-е место.`,
        dedupKey: `season-close:${season.id}:${member.id}`,
      });
    }
  }
}

function pointsOf(rows: ScoredMember[], userId: string): number {
  for (const row of rows) {
    if (row.userId === userId) {
      return row.points;
    }
  }
  return 0;
}

function previousRank(raw: string | undefined): number | null {
  if (raw === undefined) {
    return null;
  }
  const value = Number(raw);
  return Number.isNaN(value) ? null : value;
}

function byBrigadePoints(left: BrigadeTotal, right: BrigadeTotal): number {
  if (right.points !== left.points) {
    return right.points - left.points;
  }
  if (left.brigadeId < right.brigadeId) {
    return -1;
  }
  return 1;
}

function emptyBoard(season: Season): Leaderboard {
  return {
    seasonId: season.id,
    season: season.title,
    endsAt: season.endsAt.toISOString(),
    total: 0,
    rows: [],
  };
}

function notFound(message: string, code: string): NotFoundException {
  return new NotFoundException({ message, code });
}
