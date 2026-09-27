import type { LlmCompleteInput, LlmCompleteResult, LlmProvider } from '../provider';

export class NoneProvider implements LlmProvider {
  readonly name = 'none' as const;

  complete(_input: LlmCompleteInput, _signal?: AbortSignal): Promise<LlmCompleteResult> {
    return Promise.reject(new Error('LLM_PROVIDER=none'));
  }
}
