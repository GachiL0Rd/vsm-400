import {
  type InfiniteData,
  infiniteQueryOptions,
  type QueryClient,
  queryOptions,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type {
  Achievement,
  Leaderboard,
  LeaderRow,
  NextShift,
  Notice,
  NoticeKind,
  Profile,
  Run,
  RunSummary,
  Scope,
  Stats,
} from '../model';
import { ApiError, client } from './client';
import { keys } from './keys';
import type { components, paths } from './schema';

type Schemas = components['schemas'];

const PAGE = 10;

export interface NoticePage {
  unreadCount: number;
  items: Notice[];
  nextCursor: string | null;
}

export interface RunPage {
  total: number;
  runs: RunSummary[];
  nextCursor: string | null;
}

export interface BrigadePlace {
  rank: number | null;
  total: number;
}

type NoticeCache = InfiniteData<NoticePage, string | undefined>;

/**
 * limit/cursor журнала. В path-item схемы query бывает never, хотя operation
 * их принимает. Пересечение локальное: schema.d.ts не правим.
 */
type RunListQuery = { limit: number; cursor?: string };

type RunsListGet = paths['/api/v1/me/runs']['get'] & {
  parameters: {
    query?: RunListQuery;
    header?: never;
    path?: never;
    cookie?: never;
  };
};

// Ответы с кодом default openapi-fetch не считает успехом в типах. На HTTP 200 тело в data.
function payload<T>(result: { data?: unknown; error?: unknown; response: Response }): T {
  if (!result.response.ok || result.data === undefined) {
    throw ApiError.from(result.response.status, result.error);
  }
  return result.data as T;
}

function toProfile(dto: Schemas['ProfileDto_Output']): Profile {
  return {
    callsign: dto.callsign,
    position: dto.position,
    brigade: dto.brigade,
    depot: dto.depot,
    level: dto.level,
    points: dto.points,
    levelFrom: dto.levelFrom,
    levelTo: dto.levelTo,
    streakDays: dto.streakDays,
    expiring: dto.expiring,
    competencies: dto.competencies,
    trend: dto.trend,
    weakNote: dto.weakNote,
    grade: dto.grade,
  };
}

function toStats(dto: Schemas['StatsDto_Output']): Stats {
  return dto;
}

function toNextShift(dto: Schemas['NextShiftDto_Output']): NextShift {
  return dto;
}

function toRunSummary(dto: Schemas['RunListDto_Output']['runs'][number]): RunSummary {
  return dto;
}

function toRun(dto: Schemas['RunDetailDto_Output']): Run {
  return dto;
}

function toAchievement(dto: Schemas['AchievementDto_Output']): Achievement {
  return dto;
}

function toNotice(dto: Schemas['NoticeDto']): Notice {
  const notice: Notice = {
    id: dto.id,
    kind: dto.kind,
    title: dto.title,
    text: dto.text,
    at: dto.at,
    unread: dto.unread,
  };
  if (dto.link) notice.link = dto.link;
  return notice;
}

function toLeaderRow(dto: Schemas['LeaderRowDto']): LeaderRow {
  const row: LeaderRow = {
    rank: dto.rank,
    callsign: dto.callsign,
    points: dto.points,
    move: dto.move,
  };
  if (dto.me) row.me = true;
  return row;
}

function toLeaderboard(dto: Schemas['LeaderboardDto']): Leaderboard {
  return {
    season: dto.season,
    endsAt: dto.endsAt,
    total: dto.total,
    rows: dto.rows.map(toLeaderRow),
  };
}

function toBrigadePlace(dto: Schemas['BrigadePlaceDto']): BrigadePlace {
  return { rank: dto.rank, total: dto.total };
}

function runListInit(cursor: string | undefined): { params: RunsListGet['parameters'] } {
  const query: RunListQuery = { limit: PAGE };
  if (cursor) query.cursor = cursor;
  return { params: { query } };
}

function pageQuery(cursor: string | undefined): { limit: number; cursor?: string } {
  const query: { limit: number; cursor?: string } = { limit: PAGE };
  if (cursor) query.cursor = cursor;
  return query;
}

export const meQuery = queryOptions({
  queryKey: keys.me,
  queryFn: async () => toProfile(payload(await client.GET('/api/v1/me'))),
});

export const statsQuery = queryOptions({
  queryKey: keys.meStats,
  queryFn: async () => toStats(payload(await client.GET('/api/v1/me/stats'))),
});

export const nextShiftQuery = queryOptions({
  queryKey: keys.meNextShift,
  queryFn: async () => toNextShift(payload(await client.GET('/api/v1/me/next-shift'))),
});

export const runsQuery = infiniteQueryOptions({
  queryKey: keys.meRuns,
  initialPageParam: undefined as string | undefined,
  queryFn: async ({ pageParam }) => {
    const page = payload<Schemas['RunListDto_Output']>(
      await client.GET('/api/v1/me/runs', runListInit(pageParam)),
    );
    return {
      total: page.total,
      runs: page.runs.map(toRunSummary),
      nextCursor: page.nextCursor,
    };
  },
  getNextPageParam: (last) => last.nextCursor ?? undefined,
});

export function runQuery(id: string) {
  return queryOptions({
    queryKey: keys.meRun(id),
    queryFn: async () => {
      const page = payload<Schemas['RunDetailDto_Output']>(
        await client.GET('/api/v1/me/runs/{id}', { params: { path: { id } } }),
      );
      return toRun(page);
    },
  });
}

export const achievementsQuery = queryOptions({
  queryKey: keys.meAchievements,
  queryFn: async () => {
    const rows = payload<Schemas['AchievementDto_Output'][]>(
      await client.GET('/api/v1/me/achievements'),
    );
    return rows.map(toAchievement);
  },
});

export const notificationsQuery = infiniteQueryOptions({
  queryKey: keys.notifications,
  initialPageParam: undefined as string | undefined,
  queryFn: async ({ pageParam }) => {
    const page = payload<Schemas['NoticePageDto']>(
      await client.GET('/api/v1/notifications', { params: { query: pageQuery(pageParam) } }),
    );
    return {
      unreadCount: page.unreadCount,
      items: page.items.map(toNotice),
      nextCursor: page.nextCursor ?? null,
    };
  },
  getNextPageParam: (last) => last.nextCursor ?? undefined,
});

export function leaderboardQuery(scope: Scope) {
  return queryOptions({
    queryKey: keys.leaderboard(scope),
    queryFn: async () => {
      const board = payload<Schemas['LeaderboardDto']>(
        await client.GET('/api/v1/leaderboards/{scope}', { params: { path: { scope } } }),
      );
      return toLeaderboard(board);
    },
  });
}

export const brigadePlaceQuery = queryOptions({
  queryKey: keys.brigades,
  queryFn: async () => toBrigadePlace(payload(await client.GET('/api/v1/leaderboards/brigades'))),
});

export function useMe() {
  return useQuery(meQuery);
}

export function useStats() {
  return useQuery(statsQuery);
}

export function useNextShift() {
  return useQuery(nextShiftQuery);
}

export function useRuns() {
  return useInfiniteQuery(runsQuery);
}

export function useRun(id: string) {
  return useQuery({ ...runQuery(id), enabled: id.length > 0 });
}

export function useAchievements() {
  return useQuery(achievementsQuery);
}

export function useNotifications() {
  return useInfiniteQuery(notificationsQuery);
}

export function useLeaderboard(scope: Scope) {
  return useQuery(leaderboardQuery(scope));
}

export function useBrigadePlace() {
  return useQuery(brigadePlaceQuery);
}

function markRead(cache: NoticeCache, id: string): NoticeCache {
  let found = false;
  const pages = cache.pages.map((page) => {
    let hit = false;
    const items = page.items.map((item) => {
      if (item.id !== id || !item.unread) return item;
      hit = true;
      found = true;
      return { ...item, unread: false };
    });
    return hit ? { ...page, items } : page;
  });
  if (!found) return cache;
  return {
    pageParams: cache.pageParams,
    pages: pages.map((page) => ({ ...page, unreadCount: Math.max(0, page.unreadCount - 1) })),
  };
}

function markAllRead(cache: NoticeCache): NoticeCache {
  return {
    pageParams: cache.pageParams,
    pages: cache.pages.map((page) => ({
      unreadCount: 0,
      nextCursor: page.nextCursor,
      items: page.items.map((item) => (item.unread ? { ...item, unread: false } : item)),
    })),
  };
}

function prependNotice(cache: NoticeCache, notice: Notice): NoticeCache {
  for (const page of cache.pages) {
    if (page.items.some((item) => item.id === notice.id)) return cache;
  }
  const bump = notice.unread ? 1 : 0;
  return {
    pageParams: cache.pageParams,
    pages: cache.pages.map((page, index) => ({
      unreadCount: page.unreadCount + bump,
      nextCursor: page.nextCursor,
      items: index === 0 ? [notice, ...page.items] : page.items,
    })),
  };
}

function restoreNotices(queryClient: QueryClient, previous: NoticeCache | undefined): void {
  if (previous) queryClient.setQueryData(keys.notifications, previous);
}

export function useMarkNoticeRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const result = await client.POST('/api/v1/notifications/{id}/read', {
        params: { path: { id } },
      });
      return toNotice(payload(result));
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: keys.notifications });
      const previous = queryClient.getQueryData<NoticeCache>(keys.notifications);
      if (previous) queryClient.setQueryData(keys.notifications, markRead(previous, id));
      return { previous };
    },
    onError: (_error, _id, context) => {
      restoreNotices(queryClient, context?.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: keys.notifications });
    },
  });
}

export function useMarkAllNoticesRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const result = await client.POST('/api/v1/notifications/read-all');
      return payload<Schemas['UnreadCountDto']>(result);
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: keys.notifications });
      const previous = queryClient.getQueryData<NoticeCache>(keys.notifications);
      if (previous) queryClient.setQueryData(keys.notifications, markAllRead(previous));
      return { previous };
    },
    onError: (_error, _vars, context) => {
      restoreNotices(queryClient, context?.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: keys.notifications });
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseStreamNotice(raw: string): Notice | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value)) return null;
    if (
      typeof value.id !== 'string' ||
      typeof value.kind !== 'string' ||
      typeof value.title !== 'string' ||
      typeof value.text !== 'string' ||
      typeof value.at !== 'string' ||
      typeof value.unread !== 'boolean'
    ) {
      return null;
    }
    const notice: Notice = {
      id: value.id,
      kind: value.kind as NoticeKind,
      title: value.title,
      text: value.text,
      at: value.at,
      unread: value.unread,
    };
    if (typeof value.link === 'string' && value.link.length > 0) notice.link = value.link;
    return notice;
  } catch {
    return null;
  }
}

/** Кладёт событие SSE в первую страницу. Нет кэша — инвалидация, страница догрузится. */
export function acceptStreamNotice(queryClient: QueryClient, raw: string): void {
  const notice = parseStreamNotice(raw);
  if (!notice) {
    void queryClient.invalidateQueries({ queryKey: keys.notifications });
    return;
  }
  let stored = false;
  queryClient.setQueryData<NoticeCache>(keys.notifications, (cache) => {
    if (!cache) return cache;
    stored = true;
    return prependNotice(cache, notice);
  });
  if (!stored) void queryClient.invalidateQueries({ queryKey: keys.notifications });
}
