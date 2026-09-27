import createClient from 'openapi-fetch';
import type { paths } from './schema';

const AUTH_PREFIX = '/api/v1/auth/';
// 401 этих ручек — ответ по существу (неверный пароль, мёртвый refresh), а не
// истёкший access. Остальные, включая /auth/session, пробуют refresh.
const SESSION_PATH = `${AUTH_PREFIX}session`;
const NO_REFRESH = new Set(['login', 'refresh', 'logout', 'password'].map((p) => AUTH_PREFIX + p));
const baseUrl = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly title: string;
  readonly detail: string;

  constructor(status: number, code: string, title: string, detail: string) {
    super(detail);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.title = title;
    this.detail = detail;
  }

  static from(status: number, body: unknown): ApiError {
    const problem = isRecord(body) ? body : null;
    const title = stringField(problem, 'title') ?? 'Ошибка запроса';
    const detail = stringField(problem, 'detail') ?? title;
    const code = stringField(problem, 'code') ?? 'UNKNOWN';
    return new ApiError(status, code, title, detail);
  }

  static network(): ApiError {
    return new ApiError(0, 'NETWORK', 'Нет связи', 'Нет связи с сервером.');
  }
}

let refreshInFlight: Promise<boolean> | null = null;
let sessionLostHandler: (() => void) | null = null;

/** Вызывается, если refresh не восстановил сессию. */
export function setOnSessionLost(handler: (() => void) | null): void {
  sessionLostHandler = handler;
}

export async function authFetch(request: Request): Promise<Response> {
  try {
    const response = await fetch(request.clone());
    if (response.status !== 401 || NO_REFRESH.has(requestPath(request.url))) {
      return response;
    }

    const restored = await refreshAccess();
    if (restored) {
      return await fetch(request);
    }

    // 401 самой /auth/session гейт покажет как «не вошёл»; сброс кэша отсюда
    // пересоздал бы запрос сессии и зациклил refresh.
    if (requestPath(request.url) !== SESSION_PATH) sessionLostHandler?.();
    return response;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw ApiError.network();
  }
}

export const client = createClient<paths>({
  baseUrl,
  credentials: 'include',
  fetch: authFetch,
});

/** Выход: в OpenAPI у 200 нет тела, читаем только статус. */
export async function postLogout(): Promise<void> {
  try {
    const response = await fetch(`${baseUrl}${AUTH_PREFIX}logout`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!response.ok) {
      throw ApiError.from(response.status, await readJson(response));
    }
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw ApiError.network();
  }
}

/** Берёт data из ответа openapi-fetch или бросает ApiError. */
export function unwrap<T>(result: { data?: T; error?: unknown; response: Response }): T {
  if (result.response.ok && result.data !== undefined) {
    return result.data;
  }
  throw ApiError.from(result.response.status, result.error);
}

function requestPath(url: string): string {
  try {
    return new URL(url, 'http://local.invalid').pathname;
  } catch {
    return url;
  }
}

function refreshAccess(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = postRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

async function postRefresh(): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}${AUTH_PREFIX}refresh`, {
      method: 'POST',
      credentials: 'include',
    });
    // 409 REFRESH_RACE: победитель уже выдал новый access.
    return response.ok || response.status === 409;
  } catch {
    return false;
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stringField(record: Record<string, unknown> | null, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' ? value : undefined;
}
