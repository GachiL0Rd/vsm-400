import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../auth/auth-user';
import { Clock } from '../common/clock';
import type { RunRecordedPayload } from '../common/events';
import { NotificationKind, Role, type RunOutcome } from '../generated/prisma/client';
import type { NotificationsService } from '../notifications/notifications.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { RedisService } from '../redis/redis.service';
import { LeaderboardService } from './leaderboard.service';
import { seasonWindow } from './season-window';
import type { SeasonsService } from './seasons.service';

type UserRow = { id: string; callsign: string; brigadeId: string | null };
type ScoreRow = { seasonId: string; userId: string; points: number };
type BrigadeRow = { id: string; depotId: string; name: string };
type SeasonRow = { id: string; title: string; startsAt: Date; endsAt: Date };

type ScoreWhere = {
  seasonId?: string;
  points?: { gt?: number };
  user?: { brigadeId?: string; brigade?: { depotId?: string } };
};

class MemoryRedis {
  private readonly zsets = new Map<string, Map<string, number>>();
  private readonly hashes = new Map<string, Map<string, string>>();
  private readonly strings = new Map<string, string>();

  private board(key: string): Map<string, number> {
    let set = this.zsets.get(key);
    if (!set) {
      set = new Map();
      this.zsets.set(key, set);
    }
    return set;
  }

  private ranked(key: string): { member: string; score: number }[] {
    const set = this.zsets.get(key);
    if (!set) {
      return [];
    }
    const rows: { member: string; score: number }[] = [];
    for (const [member, score] of set) {
      rows.push({ member, score });
    }
    rows.sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      if (left.member < right.member) {
        return 1;
      }
      return left.member > right.member ? -1 : 0;
    });
    return rows;
  }

  async zincrby(key: string, increment: number, member: string): Promise<string> {
    const set = this.board(key);
    const next = (set.get(member) ?? 0) + increment;
    set.set(member, next);
    return String(next);
  }

  async zadd(key: string, score: number, member: string): Promise<number> {
    this.board(key).set(member, score);
    return 1;
  }

  async zcard(key: string): Promise<number> {
    return this.zsets.get(key)?.size ?? 0;
  }

  async zscore(key: string, member: string): Promise<string | null> {
    const score = this.zsets.get(key)?.get(member);
    return score === undefined ? null : String(score);
  }

  async zrevrank(key: string, member: string): Promise<number | null> {
    const index = this.ranked(key).findIndex((row) => row.member === member);
    return index < 0 ? null : index;
  }

  async zrevrange(key: string, start: number, stop: number, mode?: string): Promise<string[]> {
    const ranked = this.ranked(key);
    const end = stop < 0 ? ranked.length + stop : stop;
    const slice = ranked.slice(start, end + 1);
    if (mode !== 'WITHSCORES') {
      return slice.map((row) => row.member);
    }
    const flat: string[] = [];
    for (const row of slice) {
      flat.push(row.member, String(row.score));
    }
    return flat;
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    const hash = this.hashes.get(key);
    const result: Record<string, string> = {};
    if (!hash) {
      return result;
    }
    for (const [field, value] of hash) {
      result[field] = value;
    }
    return result;
  }

  async hset(key: string, payload: Record<string, string>): Promise<number> {
    let hash = this.hashes.get(key);
    if (!hash) {
      hash = new Map();
      this.hashes.set(key, hash);
    }
    let count = 0;
    for (const [field, value] of Object.entries(payload)) {
      hash.set(field, value);
      count += 1;
    }
    return count;
  }

  async del(...keys: string[]): Promise<number> {
    let count = 0;
    for (const key of keys) {
      const removed = this.zsets.delete(key);
      const hash = this.hashes.delete(key);
      const text = this.strings.delete(key);
      if (removed || hash || text) {
        count += 1;
      }
    }
    return count;
  }

  async set(
    key: string,
    value: string,
    _ex: 'EX',
    _seconds: number,
    nx: 'NX',
  ): Promise<'OK' | null> {
    if (nx === 'NX' && this.strings.has(key)) {
      return null;
    }
    this.strings.set(key, value);
    return 'OK';
  }

  async eval(_script: string, _numKeys: number, key: string, _ttl: string): Promise<number> {
    const current = this.strings.get(key);
    if (current === undefined || current === 'skip') {
      this.strings.set(key, 'pending');
      return 1;
    }
    return 0;
  }
}

function matchesScore(db: Harness, score: ScoreRow, where: ScoreWhere): boolean {
  if (where.seasonId && score.seasonId !== where.seasonId) {
    return false;
  }
  if (where.points?.gt !== undefined && !(score.points > where.points.gt)) {
    return false;
  }
  const user = db.users.find((row) => row.id === score.userId);
  if (where.user?.brigadeId && user?.brigadeId !== where.user.brigadeId) {
    return false;
  }
  const depotId = where.user?.brigade?.depotId;
  if (depotId) {
    const brigade = db.brigades.find((row) => row.id === user?.brigadeId);
    if (brigade?.depotId !== depotId) {
      return false;
    }
  }
  return true;
}

class Harness {
  users: UserRow[] = [];
  scores: ScoreRow[] = [];
  brigades: BrigadeRow[] = [];
  depots: { id: string }[] = [];
  seasons: SeasonRow[] = [];
  failUpsert = false;
  readonly redis = new MemoryRedis();
  readonly created: {
    userId: string;
    kind: string;
    title: string;
    text: string;
    link?: string;
    dedupKey?: string;
  }[] = [];
  readonly season: SeasonRow;
  readonly service: LeaderboardService;

  constructor() {
    const at = new Date('2026-09-26T12:00:00+03:00');
    const window = seasonWindow(at);
    this.season = {
      id: 'season-39',
      title: window.title,
      startsAt: window.startsAt,
      endsAt: window.endsAt,
    };
    this.seasons.push(this.season);
    const notifications = {
      create: vi.fn(
        async (
          userId: string,
          draft: { kind: string; title: string; text: string; link?: string; dedupKey?: string },
        ) => {
          this.created.push({ userId, ...draft });
          return { id: 'n' };
        },
      ),
    };
    const seasons = { current: vi.fn(async () => this.season) };
    const clock = new (class extends Clock {
      now(): Date {
        return at;
      }
    })();
    this.service = new LeaderboardService(
      this.prisma() as unknown as PrismaService,
      this.redis as unknown as RedisService,
      seasons as unknown as SeasonsService,
      notifications as unknown as NotificationsService,
      clock,
    );
  }

  prisma() {
    return {
      season: {
        findFirst: async ({ where }: { where: { startsAt: Date } }) =>
          this.seasons.find((row) => row.startsAt.getTime() === where.startsAt.getTime()) ?? null,
        findUnique: async ({ where }: { where: { id: string } }) =>
          this.seasons.find((row) => row.id === where.id) ?? null,
      },
      seasonScore: {
        upsert: async ({
          where,
          create,
          update,
        }: {
          where: { seasonId_userId: { seasonId: string; userId: string } };
          create: { points: number };
          update: { points: { increment: number } };
        }) => {
          if (this.failUpsert) {
            this.failUpsert = false;
            throw new Error('upsert');
          }
          const key = where.seasonId_userId;
          let row = this.scores.find(
            (score) => score.seasonId === key.seasonId && score.userId === key.userId,
          );
          if (!row) {
            row = { seasonId: key.seasonId, userId: key.userId, points: create.points };
            this.scores.push(row);
          } else {
            row.points += update.points.increment;
          }
          return row;
        },
        findMany: async ({ where, select }: { where: ScoreWhere; select?: { user?: unknown } }) => {
          const matched = this.scores.filter((score) => matchesScore(this, score, where));
          if (select?.user) {
            return matched.map((score) => ({
              points: score.points,
              user: {
                brigadeId: this.users.find((row) => row.id === score.userId)?.brigadeId ?? null,
              },
            }));
          }
          return matched.map((score) => ({ userId: score.userId, points: score.points }));
        },
      },
      user: {
        findMany: async ({ where }: { where?: { brigadeId?: string; id?: { in: string[] } } }) => {
          let rows = this.users;
          if (where?.brigadeId) {
            rows = rows.filter((user) => user.brigadeId === where.brigadeId);
          }
          if (where?.id?.in) {
            const ids = new Set(where.id.in);
            rows = rows.filter((user) => ids.has(user.id));
          }
          return rows;
        },
        findUnique: async ({ where }: { where: { id: string } }) =>
          this.users.find((user) => user.id === where.id) ?? null,
      },
      brigade: {
        findMany: async ({ where }: { where?: { depotId?: string } }) =>
          this.brigades.filter((brigade) => !where?.depotId || brigade.depotId === where.depotId),
        findUnique: async ({ where }: { where: { id: string } }) =>
          this.brigades.find((brigade) => brigade.id === where.id) ?? null,
      },
      depot: {
        findMany: async () => this.depots,
      },
    };
  }
}

function user(id: string, callsign: string, brigadeId: string | null = 'brigade-1'): UserRow {
  return { id, callsign, brigadeId };
}

function auth(id: string, brigadeId: string | null, depotId: string | null): AuthUser {
  return { id, role: Role.CONDUCTOR, brigadeId, depotId };
}

function recorded(
  partial: Partial<RunRecordedPayload> & { runId: string; userId: string },
): RunRecordedPayload {
  return {
    brigadeId: 'brigade-1',
    depotId: 'depot-1',
    points: 10,
    outcome: 'completed' as RunOutcome,
    suspicious: false,
    ...partial,
    finishedAt: partial.finishedAt ?? '2026-09-26T12:00:00.000+03:00',
  };
}

describe('рейтинг', () => {
  it('ZSET-ранги и move за сутки', async () => {
    const db = new Harness();
    db.users.push(user('a', 'AAAA'), user('b', 'BBBB'), user('c', 'CCCC'));
    db.brigades.push({ id: 'brigade-1', depotId: 'depot-1', name: '12' });
    db.depots.push({ id: 'depot-1' });
    await db.service.onRunRecorded(recorded({ runId: 'r1', userId: 'a', points: 30 }));
    await db.service.onRunRecorded(recorded({ runId: 'r2', userId: 'b', points: 20 }));
    await db.service.onRunRecorded(recorded({ runId: 'r3', userId: 'c', points: 10 }));
    await db.service.snapshotRanks();
    await db.service.onRunRecorded(recorded({ runId: 'r4', userId: 'c', points: 25 }));

    const board = await db.service.board(auth('a', 'brigade-1', 'depot-1'), 'depot');
    expect(board.seasonId).toBe('season-39');
    expect(board.season).toBe('Сезон 39');
    expect(board.total).toBe(3);
    expect(
      board.rows.map((row) => [row.callsign, row.rank, row.points, row.move, row.me ?? false]),
    ).toEqual([
      ['CCCC', 1, 35, 2, false],
      ['AAAA', 2, 30, -1, true],
      ['BBBB', 3, 20, -1, false],
    ]);
  });

  it('восстанавливает пустой ZSET из SeasonScore', async () => {
    const db = new Harness();
    db.users.push(user('a', 'AAAA', null), user('b', 'BBBB', null));
    db.scores.push(
      { seasonId: 'season-39', userId: 'b', points: 40 },
      { seasonId: 'season-39', userId: 'a', points: 70 },
    );
    const board = await db.service.board(auth('b', null, 'depot-1'), 'company');
    expect(board.rows.map((row) => [row.callsign, row.rank, row.points])).toEqual([
      ['AAAA', 1, 70],
      ['BBBB', 2, 40],
    ]);
    expect(await db.redis.zcard('lb:season-39:company')).toBe(2);
  });

  it('бригада целиком, депо — топ-5 и своя строка', async () => {
    const db = new Harness();
    db.brigades.push({ id: 'brigade-1', depotId: 'depot-1', name: '12' });
    const members = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
    for (const id of members) {
      db.users.push(user(id, id.toUpperCase().padEnd(4, 'X')));
      db.scores.push({ seasonId: 'season-39', userId: id, points: id.charCodeAt(0) });
    }
    const brigade = await db.service.board(auth('a', 'brigade-1', 'depot-1'), 'brigade');
    expect(brigade.total).toBe(9);
    expect(brigade.rows).toHaveLength(9);

    db.brigades.push({ id: 'brigade-2', depotId: 'depot-2', name: '13' });
    db.depots.push({ id: 'depot-2' });
    for (let index = 0; index < 7; index += 1) {
      db.users.push(user(`d${index}`, `D${index}XX`, 'brigade-2'));
      await db.service.onRunRecorded(
        recorded({
          runId: `depot-${index}`,
          userId: `d${index}`,
          brigadeId: 'brigade-2',
          depotId: 'depot-2',
          points: 100 - index,
        }),
      );
    }
    const depot = await db.service.board(auth('d6', 'brigade-2', 'depot-2'), 'depot');
    expect(depot.total).toBe(7);
    expect(depot.rows).toHaveLength(6);
    expect(depot.rows.at(-1)).toMatchObject({ callsign: 'D6XX', rank: 7, me: true });
  });

  it('обгон в бригаде и идемпотентность рейса', async () => {
    const db = new Harness();
    db.users.push(user('a', 'AAAA'), user('b', 'BBBB'), user('c', 'CCCC'));
    await db.service.onRunRecorded(recorded({ runId: 'c', userId: 'c', points: 200 }));
    await db.service.onRunRecorded(recorded({ runId: 'a', userId: 'a', points: 100 }));
    await db.service.onRunRecorded(recorded({ runId: 'b1', userId: 'b', points: 90 }));
    await db.service.onRunRecorded(recorded({ runId: 'b2', userId: 'b', points: 30 }));
    await db.service.onRunRecorded(recorded({ runId: 'b2', userId: 'b', points: 30 }));
    const overtaken = db.created.filter((row) => row.kind === NotificationKind.overtaken);
    expect(overtaken).toEqual([
      {
        userId: 'a',
        kind: NotificationKind.overtaken,
        title: '#BBBB поднялся на 2-е место в бригаде',
        text: 'Вы на 3-м месте, разница 20 баллов.',
        dedupKey: 'overtaken:b2:a',
      },
    ]);
    const score = db.scores.find((row) => row.userId === 'b');
    expect(score?.points).toBe(120);
  });

  it('пропускает подозрительный и нулевой рейс и откатывает сбой', async () => {
    const db = new Harness();
    db.users.push(user('a', 'AAAA'));
    await db.service.onRunRecorded(
      recorded({ runId: 'bad', userId: 'a', points: 50, suspicious: true }),
    );
    await db.service.onRunRecorded(recorded({ runId: 'zero', userId: 'a', points: 0 }));
    expect(await db.redis.zcard('lb:season-39:company')).toBe(0);
    db.failUpsert = true;
    await expect(
      db.service.onRunRecorded(recorded({ runId: 'flaky', userId: 'a', points: 40 })),
    ).rejects.toThrow(/upsert/);
    expect(db.scores).toHaveLength(0);
    await db.service.onRunRecorded(recorded({ runId: 'flaky', userId: 'a', points: 40 }));
    expect(db.scores[0]?.points).toBe(40);
  });

  it('снятый флаг текущей недели начисляет рейтинг один раз', async () => {
    const db = new Harness();
    db.users.push(user('a', 'AAAA'));
    await db.service.onRunRecorded(
      recorded({ runId: 'bad', userId: 'a', points: 40, suspicious: true }),
    );
    expect(db.scores).toHaveLength(0);
    await db.service.onRunRecorded(recorded({ runId: 'bad', userId: 'a', points: 40 }));
    await db.service.onRunRecorded(recorded({ runId: 'bad', userId: 'a', points: 40 }));
    expect(db.scores).toEqual([{ seasonId: 'season-39', userId: 'a', points: 40 }]);
    expect(await db.redis.zscore('lb:season-39:company', 'a')).toBe('40');
  });

  it('рейс прошлой недели не дописывается в текущий сезон', async () => {
    const db = new Harness();
    db.users.push(user('a', 'AAAA'));
    await db.service.onRunRecorded(
      recorded({
        runId: 'old',
        userId: 'a',
        points: 40,
        suspicious: true,
        finishedAt: '2026-08-01T12:00:00+03:00',
      }),
    );
    await db.service.onRunRecorded(
      recorded({
        runId: 'old',
        userId: 'a',
        points: 40,
        finishedAt: '2026-08-01T12:00:00+03:00',
      }),
    );
    expect(db.scores).toHaveLength(0);
    expect(await db.redis.zcard('lb:season-39:company')).toBe(0);
  });

  it('место бригады в депо и закрытие сезона топ-3', async () => {
    const db = new Harness();
    db.depots.push({ id: 'depot-1' });
    const names = ['Альфа', 'Бета', 'Гамма', 'Дельта'];
    for (let index = 0; index < names.length; index += 1) {
      const brigadeId = `b${index}`;
      const name = names[index] ?? '';
      db.brigades.push({ id: brigadeId, depotId: 'depot-1', name });
      db.users.push(user(`u${index}`, `U${index}XX`, brigadeId));
      db.scores.push({ seasonId: 'season-39', userId: `u${index}`, points: 100 - index * 10 });
    }
    await expect(db.service.board(auth('u0', 'b0', 'depot-1'), 'train')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(await db.service.brigadePlace(auth('u1', 'b1', 'depot-1'))).toEqual({
      rank: 2,
      total: 4,
    });

    const monday = new Date('2026-09-28T00:00:00+03:00');
    await db.service.closeSeason(new Date('2026-09-26T12:00:00+03:00'));
    expect(db.created).toHaveLength(0);
    await db.service.closeSeason(monday);
    const titles = db.created.map((row) => row.text);
    expect(titles).toEqual([
      'Бригада «Альфа» заняла 1-е место.',
      'Бригада «Бета» заняла 2-е место.',
      'Бригада «Гамма» заняла 3-е место.',
    ]);
    expect(db.created.every((row) => row.kind === NotificationKind.challenge)).toBe(true);
  });

  it('без бригады место пустое, а доска бригады не 404', async () => {
    const db = new Harness();
    expect(await db.service.brigadePlace(auth('solo', null, null))).toEqual({
      rank: null,
      total: 0,
    });
    const board = await db.service.board(auth('solo', null, null), 'brigade');
    expect(board).toMatchObject({ seasonId: 'season-39', season: 'Сезон 39', total: 0, rows: [] });
  });
});
