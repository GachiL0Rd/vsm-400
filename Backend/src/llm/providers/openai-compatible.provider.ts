import { LLM_MAX_TOKENS, LLM_TEMPERATURE } from '../prompt';
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
          temperature: LLM_TEMPERATURE,
          max_tokens: LLM_MAX_TOKENS,
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
