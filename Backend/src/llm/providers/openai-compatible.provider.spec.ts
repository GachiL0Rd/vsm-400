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
      repeat_penalty: number;
      thinking?: unknown;
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
    expect(body.repeat_penalty).toBe(1);
    expect(body.thinking).toBeUndefined();
    expect(init?.headers?.authorization).toBe('Bearer local-key');
  });

  it('без jsonSchema не шлёт response_format', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: 'ситуация: да' } }] }),
    }));
    await provider(fetchImpl).complete({
      messages: [{ role: 'user', content: 'проверь' }],
      temperature: 0,
      topP: 1,
    });
    const body = JSON.parse(fetchImpl.mock.calls[0]?.[1]?.body ?? '{}') as {
      response_format?: unknown;
      temperature: number;
      top_p: number;
    };
    expect(body.response_format).toBeUndefined();
    expect(body.temperature).toBe(0);
    expect(body.top_p).toBe(1);
  });

  it('профиль yandex собирает URI и не шлёт repeat_penalty и thinking', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          choices: [{ message: { content: '{"text":"а"}' } }],
          usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
        }),
    }));
    const client = new OpenAiCompatibleProvider({
      name: 'yandex',
      profile: 'yandex',
      baseUrl: 'https://ai.api.cloud.yandex.net/v1',
      model: 'aliceai-llm-flash',
      apiKey: 'ya-key',
      project: 'folder1',
      extraHeaders: { 'X-Title': 'vsm', 'x-data-logging-enabled': 'true' },
      timeoutMs: 1_000,
      fetchImpl,
    });
    const result = await client.complete({
      messages: [{ role: 'user', content: 'перефразируй' }],
      jsonSchema: schema,
      schemaName: 'scenario_text_variant',
      temperature: 1.4,
    });
    expect(client.name).toBe('yandex');
    expect(result.usage).toEqual({ prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 });
    const init = fetchImpl.mock.calls[0]?.[1];
    const body = JSON.parse(init?.body ?? '{}') as Record<string, unknown>;
    expect(body.model).toBe('gpt://folder1/aliceai-llm-flash/latest');
    expect(body.temperature).toBe(1);
    expect(body.reasoning_effort).toBe('none');
    expect(body.repeat_penalty).toBeUndefined();
    expect(body.thinking).toBeUndefined();
    expect(body.chat_template_kwargs).toBeUndefined();
    expect(init?.headers?.authorization).toBe('Bearer ya-key');
    expect(init?.headers?.['OpenAI-Project']).toBe('folder1');
    expect(init?.headers?.['x-data-logging-enabled']).toBe('false');
    expect(init?.headers?.['X-Title']).toBe('vsm');
  });

  it('готовый gpt:// URI не оборачивается второй раз', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: '{}' } }] }),
    }));
    const client = new OpenAiCompatibleProvider({
      profile: 'yandex',
      baseUrl: 'https://ai.api.cloud.yandex.net/v1',
      model: 'gpt://folder1/aliceai-llm-flash/latest',
      timeoutMs: 1_000,
      fetchImpl,
    });
    await client.complete({
      messages: [],
      jsonSchema: schema,
      schemaName: 'scenario_text_variant',
    });
    const body = JSON.parse(fetchImpl.mock.calls[0]?.[1]?.body ?? '{}') as { model: string };
    expect(body.model).toBe('gpt://folder1/aliceai-llm-flash/latest');
  });

  it('профиль vllm не шлёт repeat_penalty и thinking', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: '{}' } }] }),
    }));
    const client = new OpenAiCompatibleProvider({
      profile: 'vllm',
      baseUrl: 'http://127.0.0.1:8000',
      model: 'qwen',
      timeoutMs: 1_000,
      fetchImpl,
    });
    await client.complete({
      messages: [],
      jsonSchema: schema,
      schemaName: 'scenario_text_variant',
    });
    const body = JSON.parse(fetchImpl.mock.calls[0]?.[1]?.body ?? '{}') as Record<string, unknown>;
    expect(body.model).toBe('qwen');
    expect(body.repeat_penalty).toBeUndefined();
    expect(body.thinking).toBeUndefined();
    expect(body.chat_template_kwargs).toBeUndefined();
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.presence_penalty).toBe(0);
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
