export function requestPath(url: string): string {
  const path = url.split('?')[0] ?? url;
  if (path.length > 1 && path.endsWith('/')) {
    return path.slice(0, -1);
  }
  return path;
}

/**
 * Пока пароль временный, кабинет закрыт.
 * GET /auth/session оставлен: фронт видит живую сессию и флаг смены,
 * не читая разбор рейса. Сравнение точное — includes('/auth/') пускал любой хвост.
 */
const passwordChangePaths = new Set([
  'POST /api/v1/auth/password',
  'POST /api/v1/auth/logout',
  'GET /api/v1/auth/session',
]);

export function passwordChangeAllows(method: string, url: string): boolean {
  return passwordChangePaths.has(`${method.toUpperCase()} ${requestPath(url)}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function loginTracker(req: { ip?: string; body?: unknown }): string {
  const ip = typeof req.ip === 'string' && req.ip.length > 0 ? req.ip : 'unknown';
  const login =
    isRecord(req.body) && typeof req.body.login === 'string' ? req.body.login.trim() : '';
  return `${ip}:${login}`;
}

type HeaderMap = Record<string, string | string[] | undefined>;

export function readAccessToken(request: {
  headers?: HeaderMap;
  cookies?: Record<string, string | undefined>;
}): string | undefined {
  const header = request.headers?.authorization;
  if (typeof header === 'string') {
    const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
    if (match?.[1]) {
      return match[1];
    }
  }
  const cookie = request.cookies?.vsm_access;
  if (typeof cookie === 'string' && cookie.length > 0) {
    return cookie;
  }
  return undefined;
}

export function readRefreshCookie(
  cookies: Record<string, string | undefined> | undefined,
): string | undefined {
  const value = cookies?.vsm_refresh;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function clientIp(request: { ip?: string }): string | null {
  return typeof request.ip === 'string' && request.ip.length > 0 ? request.ip : null;
}

export function userAgent(headers: HeaderMap | undefined): string | null {
  const value = headers?.['user-agent'];
  return typeof value === 'string' && value.length > 0 ? value : null;
}
