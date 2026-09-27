import type { LlmApiProfile, LlmProviderName } from '../llm.constants';
import { LLM_MAX_TOKENS } from '../prompt';
import type { LlmCompleteInput, LlmCompleteResult, LlmProvider } from '../provider';
import {
  chatCompletionsUrl,
  type FetchLike,
  parseJsonBody,
  readChatContent,
  requestText,
} from './http';

export function yandexModelUri(model: string, folder: string | undefined): string {
  const trimmed = model.trim();
  if (trimmed.startsWith('gpt://')) {
    return trimmed;
  }
  const catalog = folder?.trim() ?? '';
  if (catalog === '') {
    throw new Error('LLM_PROJECT не задан');
  }
  const name = trimmed.replace(/^\/+|\/+$/g, '').replace(/\/latest$/i, '');
  if (name === '' || name.includes('://')) {
    throw new Error('LLM_MODEL не годится для URI Яндекса');
  }
  return `gpt://${catalog}/${name}/latest`;
}

export class OpenAiCompatibleProvider implements LlmProvider {
  readonly name: LlmProviderName;

  constructor(
    private readonly options: {
      baseUrl: string;
      model: string;
      apiKey?: string;
      project?: string;
      extraHeaders?: Record<string, string>;
      profile?: LlmApiProfile;
      name?: 'openai-compatible' | 'yandex';
      timeoutMs: number;
      temperature?: number;
      topP?: number;
      topK?: number;
      fetchImpl?: FetchLike;
    },
  ) {
    this.name = options.name ?? 'openai-compatible';
  }

  async complete(input: LlmCompleteInput, signal?: AbortSignal): Promise<LlmCompleteResult> {
    const profile = this.options.profile ?? 'llama-cpp';
    const response = await requestText({
      fetchImpl: this.options.fetchImpl ?? (globalThis.fetch as FetchLike),
      url: chatCompletionsUrl(this.options.baseUrl),
      timeoutMs: this.options.timeoutMs,
      signal,
      init: {
        method: 'POST',
        headers: chatHeaders(profile, this.options),
        body: JSON.stringify(chatBody(profile, this.options, input)),
      },
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`LLM HTTP ${response.status}: ${response.text.slice(0, 200)}`);
    }
    const parsed = readChatContent(parseJsonBody(response.text, 'LLM'));
    return {
      content: parsed.content,
      model: parsed.model ?? this.options.model,
      ...(parsed.usage ? { usage: parsed.usage } : {}),
    };
  }
}

function chatHeaders(
  profile: LlmApiProfile,
  options: {
    apiKey?: string;
    project?: string;
    extraHeaders?: Record<string, string>;
  },
): Record<string, string> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    ...options.extraHeaders,
  };
  assignHeader(headers, 'content-type', 'application/json');
  if (options.apiKey) {
    assignHeader(headers, 'authorization', `Bearer ${options.apiKey}`);
  }
  if (options.project) {
    assignHeader(headers, 'OpenAI-Project', options.project);
  }
  if (profile === 'yandex') {
    assignHeader(headers, 'x-data-logging-enabled', 'false');
  }
  return headers;
}

function assignHeader(headers: Record<string, string>, name: string, value: string): void {
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === name.toLowerCase()) {
      delete headers[key];
    }
  }
  headers[name] = value;
}

function chatBody(
  profile: LlmApiProfile,
  options: {
    model: string;
    project?: string;
    temperature?: number;
    topP?: number;
    topK?: number;
  },
  input: LlmCompleteInput,
): Record<string, unknown> {
  const fallback = profile === 'yandex' ? 1 : 0.7;
  let temperature = input.temperature ?? options.temperature ?? fallback;
  if (profile === 'yandex') {
    temperature = Math.min(Math.max(temperature, 0), 1);
  }
  const body: Record<string, unknown> = {
    model: profile === 'yandex' ? yandexModelUri(options.model, options.project) : options.model,
    messages: input.messages,
    temperature,
    top_p: input.topP ?? options.topP ?? 0.8,
    max_tokens: LLM_MAX_TOKENS,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: input.schemaName,
        strict: true,
        schema: input.jsonSchema,
      },
    },
  };
  if (profile === 'llama-cpp') {
    body.top_k = options.topK ?? 20;
    body.min_p = 0;
    body.repeat_penalty = 1;
    body.presence_penalty = 0;
    body.frequency_penalty = 0;
    body.reasoning_effort = 'none';
    body.chat_template_kwargs = { enable_thinking: false };
  } else if (profile === 'vllm') {
    body.presence_penalty = 0;
    body.frequency_penalty = 0;
  } else {
    body.top_k = options.topK ?? 20;
    body.min_p = 0;
    body.presence_penalty = 0;
    body.frequency_penalty = 0;
    body.reasoning_effort = 'none';
  }
  return body;
}
