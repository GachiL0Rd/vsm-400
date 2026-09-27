export type FetchInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
  dispatcher?: unknown;
};

export type FetchLike = (
  url: string,
  init?: FetchInit,
) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}>;

export async function requestText(input: {
  fetchImpl: FetchLike;
  url: string;
  timeoutMs: number;
  signal?: AbortSignal;
  init: FetchInit;
}): Promise<{ status: number; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  const onAbort = () => controller.abort();
  input.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    if (input.signal?.aborted) {
      controller.abort();
    }
    const response = await input.fetchImpl(input.url, { ...input.init, signal: controller.signal });
    const text = await response.text();
    return { status: response.status, text };
  } catch (error) {
    if (controller.signal.aborted && input.signal?.aborted !== true) {
      throw new Error(`таймаут LLM ${input.timeoutMs} мс`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener('abort', onAbort);
  }
}

export function parseJsonBody(text: string, label: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${label}: ответ не JSON`);
  }
}

export function readChatContent(body: unknown): {
  content: string;
  model: string | undefined;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
} {
  const record = asRecord(body);
  if (!record) {
    throw new Error('LLM: ответ не JSON');
  }
  const model = typeof record.model === 'string' ? record.model : undefined;
  if (!Array.isArray(record.choices) || record.choices.length === 0) {
    throw new Error('LLM: нет choices');
  }
  const first = asRecord(record.choices[0]);
  const message = first ? asRecord(first.message) : null;
  const content = message?.content;
  if (typeof content !== 'string' || content.trim() === '') {
    throw new Error('LLM: пустой content');
  }
  const usage = readUsage(record.usage);
  return usage ? { content, model, usage } : { content, model };
}

function readUsage(
  value: unknown,
): { prompt_tokens: number; completion_tokens: number; total_tokens: number } | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const promptTokens = asCount(record.prompt_tokens);
  const completionTokens = asCount(record.completion_tokens);
  const totalTokens = asCount(record.total_tokens);
  if (promptTokens === undefined || completionTokens === undefined || totalTokens === undefined) {
    return undefined;
  }
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens,
  };
}

function asCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function chatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  const origin = trimmed.replace(/\/v1$/i, '');
  return `${origin}/v1/chat/completions`;
}
