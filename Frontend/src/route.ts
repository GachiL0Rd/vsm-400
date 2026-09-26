import { useSyncExternalStore } from 'react';

export type Route =
  | { name: 'shift' }
  | { name: 'profile' }
  | { name: 'rating' }
  | { name: 'feed' }
  | { name: 'run'; id: string }
  | { name: 'missing' };

export const href = {
  shift: '#/',
  profile: '#/profile',
  rating: '#/rating',
  feed: '#/feed',
  run: (id: string) => `#/runs/${id}`,
};

function parse(hash: string): Route {
  const path = hash.replace(/^#/, '') || '/';
  if (path === '/') return { name: 'shift' };
  if (path === '/profile') return { name: 'profile' };
  if (path === '/rating') return { name: 'rating' };
  if (path === '/feed') return { name: 'feed' };
  const run = /^\/runs\/([\w-]+)$/.exec(path);
  if (run) return { name: 'run', id: run[1] };
  return { name: 'missing' };
}

function subscribe(onChange: () => void) {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

export function useRoute(): Route {
  return parse(useSyncExternalStore(subscribe, () => window.location.hash));
}
