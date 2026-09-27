import type { AppConfig } from '../../config/env';
import type { LlmProvider } from '../provider';
import { GigaChatProvider, type TokenCache } from './gigachat.provider';
import { NoneProvider } from './none.provider';
import { OpenAiCompatibleProvider } from './openai-compatible.provider';

export type RedisTokenStore = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, expiryMode: 'EX', ttlSeconds: number): Promise<unknown>;
};

export function createLlmProvider(config: AppConfig, redis: RedisTokenStore): LlmProvider {
  if (config.llmProvider === 'none') {
    return new NoneProvider();
  }
  if (config.llmProvider === 'openai-compatible') {
    return new OpenAiCompatibleProvider({
      baseUrl: required(config.llmBaseUrl, 'LLM_BASE_URL'),
      model: required(config.llmModel, 'LLM_MODEL'),
      apiKey: config.llmApiKey,
      timeoutMs: config.llmTimeoutMs,
    });
  }
  return new GigaChatProvider({
    authKey: required(config.gigachatAuthKey, 'GIGACHAT_AUTH_KEY'),
    scope: config.gigachatScope,
    model: required(config.llmModel, 'LLM_MODEL'),
    caFile: required(config.gigachatCaFile, 'GIGACHAT_CA_FILE'),
    timeoutMs: config.llmTimeoutMs,
    cache: redisTokenCache(redis),
  });
}

export function redisTokenCache(redis: RedisTokenStore): TokenCache {
  return {
    get: (key) => redis.get(key),
    set: async (key, value, ttlSeconds) => {
      await redis.set(key, value, 'EX', ttlSeconds);
    },
  };
}

function required(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`${name} не задан`);
  }
  return value;
}
