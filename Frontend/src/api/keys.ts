/** Ключи TanStack Query. Иерархия: сначала сущность, потом уточнение. */
export const keys = {
  session: ['session'] as const,
  authUser: ['auth', 'user'] as const,
  me: ['me'] as const,
  meRuns: ['me', 'runs'] as const,
};
