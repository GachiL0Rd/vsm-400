import { isIP } from 'node:net';

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

/** Жёсткий потолок с одного адреса. 20, а не 5: за NAT сидит несколько человек. */
export const AUTH_IP_LIMIT = 20;
/** Отдельный потолок на нормализованный логин, чтобы не распылять argon2. */
export const AUTH_LOGIN_LIMIT = 5;
export const AUTH_PASSWORD_LIMIT = 5;
const LOGIN_KEY_MAX = 64;

export function throttleIp(ip: string | undefined): string {
  if (!ip) {
    return 'unknown';
  }
  const mapped = ip.toLowerCase().startsWith('::ffff:') ? ip.slice('::ffff:'.length) : ip;
  if (isIP(mapped) === 4) {
    return mapped;
  }
  if (isIP(ip) === 6) {
    return `${expandIpv6(ip).slice(0, 4).join(':')}::/64`;
  }
  return 'unknown';
}

/** Ключ лимита — логин после тех же trim и 64 символов, что у DTO, до валидации тела. */
export function loginRateKey(body: unknown): string {
  if (typeof body !== 'object' || body === null || !('login' in body)) {
    return '';
  }
  const login = body.login;
  if (typeof login !== 'string') {
    return '';
  }
  return login.trim().slice(0, LOGIN_KEY_MAX);
}

export function passwordRateKey(req: { user?: { id?: string }; ip?: string }): string {
  const id = req.user?.id;
  if (typeof id === 'string' && id.length > 0) {
    return id;
  }
  return throttleIp(req.ip);
}

function expandIpv6(address: string): string[] {
  let input = address.toLowerCase();
  const zone = input.indexOf('%');
  if (zone !== -1) {
    input = input.slice(0, zone);
  }
  if (input.includes('.')) {
    const last = input.lastIndexOf(':');
    const octets = input
      .slice(last + 1)
      .split('.')
      .map((part) => Number(part));
    const hi = (((octets[0] ?? 0) << 8) | (octets[1] ?? 0)).toString(16);
    const lo = (((octets[2] ?? 0) << 8) | (octets[3] ?? 0)).toString(16);
    input = `${input.slice(0, last)}:${hi}:${lo}`;
  }
  const halves = input.split('::');
  const head = halves[0] ? halves[0].split(':').filter((part) => part.length > 0) : [];
  const tail =
    halves.length === 2 && halves[1] ? halves[1].split(':').filter((part) => part.length > 0) : [];
  const missing = halves.length === 2 ? 8 - head.length - tail.length : 0;
  const full = [...head, ...Array.from({ length: Math.max(missing, 0) }, () => '0'), ...tail];
  return full.slice(0, 8).map((part) => part.padStart(4, '0'));
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
