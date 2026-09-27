import { loadLocalEnv } from '../config/load-env';

/**
 * Декоратор воркера считается при импорте, раньше фабрики Nest.
 * loadEnvFile не затирает переменные, которые уже задал процесс или vitest.
 */
loadLocalEnv();

export const LLM_QUEUE = 'llm-variants';
export const LLM_JOB_NAME = 'generate';

export const LLM_WORKER_CONCURRENCY = readConcurrency(process.env.LLM_CONCURRENCY);

export const LLM_JOB_ATTEMPTS = 3;
export const LLM_BACKOFF_MS = 2_000;
export const LLM_RATE_MAX = 20;
export const LLM_RATE_WINDOW_MS = 10_000;

export const LLM_REJECTED_KEY = 'llm:rejected';
export const LLM_ERRORS_KEY = 'llm:errors';
export const LLM_ERROR_LIMIT = 20;

export const GIGACHAT_OAUTH_URL = 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth';
export const GIGACHAT_CHAT_URL = 'https://gigachat.devices.sberbank.ru/api/v1/chat/completions';
export const GIGACHAT_TOKEN_SKEW_MS = 60_000;

export const LLM_PROVIDER = Symbol('LLM_PROVIDER');

export type LlmProviderName = 'openai-compatible' | 'gigachat' | 'none';
export type LlmJobReason = 'seed' | 'refill' | 'live' | 'manual';
export type TextVariantReasonName = 'SEED' | 'REFILL' | 'LIVE' | 'MANUAL';

export function variantReason(reason: LlmJobReason): TextVariantReasonName {
  if (reason === 'seed') {
    return 'SEED';
  }
  if (reason === 'refill') {
    return 'REFILL';
  }
  if (reason === 'live') {
    return 'LIVE';
  }
  return 'MANUAL';
}

export type LlmJobData = {
  scenarioId: string;
  version: number;
  nodeId: string;
  persona: string;
  reason: LlmJobReason;
  sessionId?: string;
};

export function readConcurrency(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') {
    return 2;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 32) {
    return 2;
  }
  return value;
}

export function gigachatTokenKey(scope: string): string {
  return `llm:gigachat:token:${scope}`;
}
