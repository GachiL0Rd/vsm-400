import type { LlmProviderName } from './llm.constants';

export type LlmMessage = {
  role: 'system' | 'user';
  content: string;
};

export type LlmCompleteInput = {
  messages: readonly LlmMessage[];
  jsonSchema: Record<string, unknown>;
  schemaName: string;
  /** Судья смысла зовёт ту же модель, но с нулевой температурой. */
  temperature?: number;
  topP?: number;
};

export type LlmCompleteResult = {
  content: string;
  model: string;
};

export interface LlmProvider {
  readonly name: LlmProviderName;
  complete(input: LlmCompleteInput, signal?: AbortSignal): Promise<LlmCompleteResult>;
}
