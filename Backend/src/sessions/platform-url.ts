/** Кабинет открывает клиент игры с билетом в query. URLSearchParams кодирует сам. */
export function gameLaunchUrl(publicGameUrl: string, ticket: string): string {
  const url = new URL(publicGameUrl);
  url.searchParams.set('sessionKey', ticket);
  return url.toString();
}

/** Хвост слэша у PUBLIC_APP_URL не удваивает слэш. Query и hash базы в редирект не входят. */
export function runRedirectUrl(publicAppUrl: string, runId: string): string {
  const url = new URL(publicAppUrl);
  const base = url.pathname.replace(/\/+$/, '');
  url.pathname = `${base}/runs/${runId}`;
  url.search = '';
  url.hash = '';
  return url.toString();
}
