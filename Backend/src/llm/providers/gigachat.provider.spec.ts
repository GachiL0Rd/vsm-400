import { describe, expect, it, vi } from 'vitest';
import { GIGACHAT_CHAT_URL, GIGACHAT_OAUTH_URL } from '../llm.constants';
import { GigaChatProvider, readToken, type TokenCache } from './gigachat.provider';
import type { FetchLike } from './http';

const schema = { type: 'object', additionalProperties: false };

function memoryCache(): TokenCache & { saved: { key: string; ttl: number }[] } {
  const values = new Map<string, string>();
  const saved: { key: string; ttl: number }[] = [];
  return {
    saved,
    async get(key) {
      return values.get(key) ?? null;
    },
    async set(key, value, ttlSeconds) {
      values.set(key, value);
      saved.push({ key, ttl: ttlSeconds });
    },
  };
}

describe('readToken', () => {
  it('принимает expires_at в миллисекундах и в секундах', () => {
    expect(readToken({ access_token: 'a', expires_at: 1_700_000_000_000 }).expiresAtMs).toBe(
      1_700_000_000_000,
    );
    expect(readToken({ access_token: 'a', expires_at: 1_700_000_000 }).expiresAtMs).toBe(
      1_700_000_000_000,
    );
  });
});

describe('GigaChatProvider', () => {
  it('берёт OAuth один раз и кладёт токен в кеш до expires_at − 60 с', async () => {
    const expiresAt = Date.now() + 30 * 60 * 1_000;
    const fetchImpl = vi.fn<FetchLike>(async (url) => {
      if (url === GIGACHAT_OAUTH_URL) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ access_token: 'token-1', expires_at: expiresAt }),
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            model: 'GigaChat',
            choices: [{ message: { content: '{"ok":true}' } }],
          }),
      };
    });
    const cache = memoryCache();
    const client = new GigaChatProvider({
      authKey: 'base64-key',
      scope: 'GIGACHAT_API_PERS',
      model: 'GigaChat',
      timeoutMs: 1_000,
      cache,
      caPem: 'not-a-real-cert',
      fetchImpl,
    });
    const input = {
      messages: [{ role: 'user' as const, content: 'перефразируй' }],
      jsonSchema: schema,
      schemaName: 'scenario_text_variant',
    };
    const first = await client.complete(input);
    const second = await client.complete(input);
    expect(first.content).toBe('{"ok":true}');
    expect(second.model).toBe('GigaChat');
    const oauthCalls = fetchImpl.mock.calls.filter((call) => call[0] === GIGACHAT_OAUTH_URL);
    const chatCalls = fetchImpl.mock.calls.filter((call) => call[0] === GIGACHAT_CHAT_URL);
    expect(oauthCalls).toHaveLength(1);
    expect(chatCalls).toHaveLength(2);

    const oauthInit = oauthCalls[0]?.[1];
    expect(oauthInit?.headers?.authorization).toBe('Basic base64-key');
    expect(oauthInit?.headers?.RqUID).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(oauthInit?.body).toBe('scope=GIGACHAT_API_PERS');
    expect(oauthInit?.dispatcher).toBeTruthy();

    const chatBody = JSON.parse(chatCalls[0]?.[1]?.body ?? '{}') as {
      response_format: { type: string; schema: unknown; strict: boolean };
    };
    expect(chatBody.response_format).toEqual({ type: 'json_schema', schema, strict: true });
    expect(chatCalls[0]?.[1]?.headers?.authorization).toBe('Bearer token-1');
    expect(cache.saved[0]?.key).toBe('llm:gigachat:token:GIGACHAT_API_PERS');
    expect(cache.saved[0]?.ttl).toBeGreaterThan(1_700);
    expect(cache.saved[0]?.ttl).toBeLessThan(1_800);
  });

  it('не ходит в OAuth, если токен уже в кеше', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }),
    }));
    const client = new GigaChatProvider({
      authKey: 'base64-key',
      scope: 'GIGACHAT_API_PERS',
      model: 'GigaChat',
      timeoutMs: 1_000,
      cache: { get: async () => 'cached-token', set: async () => undefined },
      caPem: 'not-a-real-cert',
      fetchImpl,
    });
    await client.complete({
      messages: [],
      jsonSchema: schema,
      schemaName: 'scenario_text_variant',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(GIGACHAT_CHAT_URL);
    expect(fetchImpl.mock.calls[0]?.[1]?.headers?.authorization).toBe('Bearer cached-token');
  });
});
