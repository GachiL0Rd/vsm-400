import { describe, expect, it, vi } from 'vitest';
import type { FetchLike } from './http';
import { OpenAiCompatibleProvider } from './openai-compatible.provider';

const schema = { type: 'object' };

function provider(fetchImpl: FetchLike, timeoutMs = 1_000): OpenAiCompatibleProvider {
  return new OpenAiCompatibleProvider({
    baseUrl: 'http://127.0.0.1:8081/',
    model: 'bonsai-2-27b',
    apiKey: 'local-key',
    timeoutMs,
    fetchImpl,
  });
}

describe('openai-совместимый провайдер', () => {
  it('шлёт json_schema и читает content', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          model: 'bonsai-2-27b',
          choices: [{ message: { content: '{"text":"а"}' } }],
        }),
    }));
    const result = await provider(fetchImpl).complete({
      messages: [{ role: 'user', content: 'перефразируй' }],
      jsonSchema: schema,
      schemaName: 'scenario_text_variant',
    });
    expect(result).toEqual({ content: '{"text":"а"}', model: 'bonsai-2-27b' });
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('http://127.0.0.1:8081/v1/chat/completions');
    const body = JSON.parse(init?.body ?? '{}') as {
      response_format: { type: string; json_schema: { name: string; strict: boolean } };
      temperature: number;
      top_p: number;
      top_k: number;
      max_tokens: number;
      reasoning_effort: string;
      chat_template_kwargs: { enable_thinking: boolean };
    };
    expect(body.response_format.type).toBe('json_schema');
    expect(body.response_format.json_schema).toMatchObject({
      name: 'scenario_text_variant',
      strict: true,
      schema,
    });
    expect(body.temperature).toBe(0.7);
    expect(body.top_p).toBe(0.8);
    expect(body.top_k).toBe(20);
    expect(body.max_tokens).toBe(256);
    expect(body.reasoning_effort).toBe('none');
    expect(body.chat_template_kwargs.enable_thinking).toBe(false);
    expect(init?.headers?.authorization).toBe('Bearer local-key');
  });

  it('обрезает /v1 у базы и поднимает HTTP-ошибку', async () => {
    const fetchImpl = vi.fn<FetchLike>(async (url) => ({
      ok: false,
      status: 503,
      text: async () => `down ${url}`,
    }));
    const client = new OpenAiCompatibleProvider({
      baseUrl: 'http://127.0.0.1:8081/v1',
      model: 'bonsai-2-27b',
      timeoutMs: 1_000,
      fetchImpl,
    });
    await expect(
      client.complete({ messages: [], jsonSchema: schema, schemaName: 'scenario_text_variant' }),
    ).rejects.toThrow(/LLM HTTP 503/);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('http://127.0.0.1:8081/v1/chat/completions');
  });

  it('обрывает запрос по таймауту', async () => {
    const fetchImpl: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new Error('aborted'));
        });
      });
    const client = provider(fetchImpl, 15);
    await expect(
      client.complete({ messages: [], jsonSchema: schema, schemaName: 'scenario_text_variant' }),
    ).rejects.toThrow(/таймаут LLM 15 мс/);
  });
});
