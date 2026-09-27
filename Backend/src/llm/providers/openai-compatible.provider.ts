import { LLM_MAX_TOKENS } from '../prompt';
import type { LlmCompleteInput, LlmCompleteResult, LlmProvider } from '../provider';
import {
  chatCompletionsUrl,
  type FetchLike,
  parseJsonBody,
  readChatContent,
  requestText,
} from './http';

export class OpenAiCompatibleProvider implements LlmProvider {
  readonly name = 'openai-compatible' as const;

  constructor(
    private readonly options: {
      baseUrl: string;
      model: string;
      apiKey?: string;
      timeoutMs: number;
      temperature?: number;
      topP?: number;
      topK?: number;
      fetchImpl?: FetchLike;
    },
  ) {}

  async complete(input: LlmCompleteInput, signal?: AbortSignal): Promise<LlmCompleteResult> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json',
    };
    if (this.options.apiKey) {
      headers.authorization = `Bearer ${this.options.apiKey}`;
    }
    const response = await requestText({
      fetchImpl: this.options.fetchImpl ?? (globalThis.fetch as FetchLike),
      url: chatCompletionsUrl(this.options.baseUrl),
      timeoutMs: this.options.timeoutMs,
      signal,
      init: {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: this.options.model,
          messages: input.messages,
          temperature: input.temperature ?? this.options.temperature ?? 0.7,
          top_p: input.topP ?? this.options.topP ?? 0.8,
          top_k: this.options.topK ?? 20,
          min_p: 0,
          repeat_penalty: 1,
          presence_penalty: 0,
          frequency_penalty: 0,
          max_tokens: LLM_MAX_TOKENS,
          reasoning_effort: 'none',
          chat_template_kwargs: { enable_thinking: false },
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: input.schemaName,
              strict: true,
              schema: input.jsonSchema,
            },
          },
        }),
      },
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`LLM HTTP ${response.status}: ${response.text.slice(0, 200)}`);
    }
    const parsed = readChatContent(parseJsonBody(response.text, 'LLM'));
    return { content: parsed.content, model: parsed.model ?? this.options.model };
  }
}
