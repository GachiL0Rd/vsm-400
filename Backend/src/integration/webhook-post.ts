import { request as httpRequest, type RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { AppConfig } from '../config/env';
import { WEBHOOK_TIMEOUT_MS } from './webhook-signature';
import type { ResolvedAddress } from './webhook-url';

export type WebhookPostInput = {
  url: string;
  body: string;
  headers: Record<string, string>;
  addresses: readonly ResolvedAddress[];
};

export type WebhookPost = (input: WebhookPostInput) => Promise<{ status: number }>;

type LookupOptions = {
  all?: boolean;
};

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | { address: string; family: number }[],
  family?: number,
) => void;

/** Тестовый контур не открывает сокеты. Подпись проверяет подмена WEBHOOK_POST. */
export const testWebhookPost: WebhookPost = async () => ({ status: 200 });

export function webhookPostFor(config: AppConfig): WebhookPost {
  return config.nodeEnv === 'test' ? testWebhookPost : postWebhookPinned;
}

/**
 * Сокет открывается на адрес, который уже прошёл screenWebhookUrl.
 * Повторный DNS дал бы шанс на rebinding. Тело ответа уничтожается сразу:
 * статус известен, буфер на мегабайты не нужен.
 */
export function postWebhookPinned(input: WebhookPostInput): Promise<{ status: number }> {
  const url = new URL(input.url);
  const pinned = input.addresses[0];
  if (!pinned) {
    return Promise.reject(new Error('dns'));
  }
  const transport = url.protocol === 'https:' ? httpsRequest : httpRequest;
  const payload = Buffer.from(input.body);
  const hostname = bareHost(url.hostname);
  return new Promise((resolve, reject) => {
    const options = {
      protocol: url.protocol,
      hostname,
      port: url.port === '' ? undefined : Number(url.port),
      path: `${url.pathname}${url.search}`,
      method: 'POST',
      headers: {
        ...input.headers,
        'content-length': String(payload.length),
      },
      servername: hostname,
      autoSelectFamily: false,
      lookup: (
        _hostname: string,
        optionsOrCallback: LookupOptions | LookupCallback,
        maybeCallback: LookupCallback,
      ) => {
        const done: LookupCallback =
          typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback;
        const all = isLookupAll(optionsOrCallback);
        if (all) {
          done(null, [{ address: pinned.address, family: pinned.family }]);
          return;
        }
        done(null, pinned.address, pinned.family);
      },
    } as RequestOptions;
    const req = transport(options, (res) => {
      const status = res.statusCode ?? 0;
      res.destroy();
      resolve({ status });
    });
    req.setTimeout(WEBHOOK_TIMEOUT_MS, () => {
      const error = new Error('timeout');
      error.name = 'TimeoutError';
      req.destroy(error);
    });
    req.on('error', reject);
    req.end(payload);
  });
}

function bareHost(hostname: string): string {
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    return hostname.slice(1, -1);
  }
  return hostname;
}

function isLookupAll(options: LookupOptions | LookupCallback): boolean {
  return typeof options === 'object' && options !== null && options.all === true;
}
