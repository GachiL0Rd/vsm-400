/** Ключи TanStack Query. Иерархия: сначала сущность, потом уточнение. */
export const keys = {
  session: ['session'] as const,
  authUser: ['auth', 'user'] as const,
  me: ['me'] as const,
  meStats: ['me', 'stats'] as const,
  meNextShift: ['me', 'next-shift'] as const,
  meRuns: ['me', 'runs'] as const,
  meRun: (id: string) => ['me', 'runs', id] as const,
  meAchievements: ['me', 'achievements'] as const,
  notifications: ['notifications'] as const,
  leaderboard: (scope: string) => ['leaderboards', scope] as const,
  brigades: ['leaderboards', 'brigades'] as const,
};
