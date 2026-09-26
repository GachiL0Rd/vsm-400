import { matchPath } from 'react-router';

// Адреса кабинета. Компоненты не пишут пути строками.
export const paths = {
  shift: '/',
  profile: '/profile',
  rating: '/rating',
  feed: '/feed',
  runPattern: '/runs/:id',
  run: (id: string) => `/runs/${encodeURIComponent(id)}`,
} as const;

/** Сегмент `/runs/:id` или null. Любой id без `/`, включая кириллицу. */
export function runId(pathname: string): string | null {
  return matchPath(paths.runPattern, pathname)?.params.id || null;
}
