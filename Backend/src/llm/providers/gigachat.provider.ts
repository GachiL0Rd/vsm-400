import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Agent, fetch as undiciFetch } from 'undici';
import {
  GIGACHAT_CHAT_URL,
  GIGACHAT_OAUTH_URL,
  GIGACHAT_TOKEN_SKEW_MS,
  gigachatTokenKey,
} from '../llm.constants';
import { LLM_MAX_TOKENS } from '../prompt';
import type { LlmCompleteInput, LlmCompleteResult, LlmProvider } from '../provider';
import { type FetchLike, parseJsonBody, readChatContent, requestText } from './http';

export type TokenCache = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
};

export class GigaChatProvider implements LlmProvider {
  readonly name = 'gigachat' as const;
  private readonly dispatcher: unknown;
  private readonly fetchImpl: FetchLike;

  constructor(
    private readonly options: {
      authKey: string;
      scope: string;
      model: string;
      timeoutMs: number;
      temperature?: number;
      cache: TokenCache;
      caPem?: string | Buffer;
      caFile?: string;
      fetchImpl?: FetchLike;
      oauthUrl?: string;
      chatUrl?: string;
    },
  ) {
    const pem = options.caPem ?? (options.caFile ? readFileSync(options.caFile) : undefined);
    if (pem === undefined) {
      throw new Error('GigaChat: нет сертификата НУЦ Минцифры');
    }
    this.dispatcher = new Agent({ connect: { ca: pem } });
    this.fetchImpl = options.fetchImpl ?? (undiciFetch as FetchLike);
  }

  async complete(input: LlmCompleteInput, signal?: AbortSignal): Promise<LlmCompleteResult> {
    const token = await this.token(signal);
    const response = await requestText({
      fetchImpl: this.fetchImpl,
      url: this.options.chatUrl ?? GIGACHAT_CHAT_URL,
      timeoutMs: this.options.timeoutMs,
      signal,
      init: {
        method: 'POST',
        dispatcher: this.dispatcher,
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(chatBody(this.options, input)),
      },
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`GigaChat HTTP ${response.status}: ${response.text.slice(0, 200)}`);
    }
    const parsed = readChatContent(parseJsonBody(response.text, 'GigaChat'));
    return {
      content: parsed.content,
      model: parsed.model ?? this.options.model,
      ...(parsed.usage ? { usage: parsed.usage } : {}),
    };
  }

  private async token(signal?: AbortSignal): Promise<string> {
    const key = gigachatTokenKey(this.options.scope);
    const cached = await this.options.cache.get(key);
    if (cached) {
      return cached;
    }
    const response = await requestText({
      fetchImpl: this.fetchImpl,
      url: this.options.oauthUrl ?? GIGACHAT_OAUTH_URL,
      timeoutMs: this.options.timeoutMs,
      signal,
      init: {
        method: 'POST',
        dispatcher: this.dispatcher,
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
          authorization: `Basic ${this.options.authKey}`,
          RqUID: randomUUID(),
        },
        body: `scope=${encodeURIComponent(this.options.scope)}`,
      },
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`GigaChat OAuth HTTP ${response.status}: ${response.text.slice(0, 200)}`);
    }
    const issued = readToken(parseJsonBody(response.text, 'GigaChat OAuth'));
    const ttlMs = issued.expiresAtMs - Date.now() - GIGACHAT_TOKEN_SKEW_MS;
    if (ttlMs > 1_000) {
      await this.options.cache.set(key, issued.token, Math.floor(ttlMs / 1_000));
    }
    return issued.token;
  }
}

function chatBody(
  options: { model: string; temperature?: number },
  input: LlmCompleteInput,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: options.model,
    messages: input.messages,
    temperature: input.temperature ?? options.temperature ?? 1,
    max_tokens: LLM_MAX_TOKENS,
    repetition_penalty: 1,
  };
  if (input.jsonSchema) {
    // Форма GigaChat, не OpenAI: schema лежит рядом с type.
    body.response_format = {
      type: 'json_schema',
      schema: input.jsonSchema,
      strict: true,
    };
  }
  return body;
}

export function readToken(body: unknown): { token: string; expiresAtMs: number } {
  if (typeof body !== 'object' || body === null) {
    throw new Error('GigaChat OAuth: ответ не JSON');
  }
  const token = (body as { access_token?: unknown }).access_token;
  const expiresAt = (body as { expires_at?: unknown }).expires_at;
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error('GigaChat OAuth: нет access_token');
  }
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) {
    throw new Error('GigaChat OAuth: нет expires_at');
  }
  // Справка post-token: миллисекунды. Старый пример overview — секунды. Берём оба.
  const expiresAtMs = expiresAt < 1_000_000_000_000 ? expiresAt * 1_000 : expiresAt;
  return { token, expiresAtMs };
}
