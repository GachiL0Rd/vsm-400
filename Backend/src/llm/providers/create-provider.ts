import type { AppConfig } from '../../config/env';
import type { LlmApiProfile, LlmProviderName } from '../llm.constants';
import type { LlmProvider } from '../provider';
import { GigaChatProvider, type TokenCache } from './gigachat.provider';
import { chatCompletionsUrl } from './http';
import { NoneProvider } from './none.provider';
import { OpenAiCompatibleProvider } from './openai-compatible.provider';

export type RedisTokenStore = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, expiryMode: 'EX', ttlSeconds: number): Promise<unknown>;
};

type LlmRole = 'generate' | 'judge';

type Endpoint = {
  provider: LlmProviderName;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  project?: string;
  extraHeaders?: Record<string, string>;
  profile: LlmApiProfile;
};

export function createLlmProvider(
  config: AppConfig,
  redis: RedisTokenStore,
  role: LlmRole = 'generate',
): LlmProvider {
  const endpoint = role === 'judge' ? judgeEndpoint(config) : generateEndpoint(config);
  const modelName = role === 'judge' ? 'LLM_JUDGE_MODEL' : 'LLM_MODEL';
  const baseName = role === 'judge' ? 'LLM_JUDGE_BASE_URL' : 'LLM_BASE_URL';
  if (endpoint.provider === 'none') {
    return new NoneProvider();
  }
  if (endpoint.provider === 'gigachat') {
    return new GigaChatProvider({
      authKey: required(config.gigachatAuthKey, 'GIGACHAT_AUTH_KEY'),
      scope: config.gigachatScope,
      model: required(endpoint.model, modelName),
      caFile: required(config.gigachatCaFile, 'GIGACHAT_CA_FILE'),
      timeoutMs: config.llmTimeoutMs,
      temperature: config.llmTemperature,
      cache: redisTokenCache(redis),
      chatUrl: chatCompletionsUrl(config.gigachatBaseUrl),
    });
  }
  const profile: LlmApiProfile = endpoint.provider === 'yandex' ? 'yandex' : endpoint.profile;
  return new OpenAiCompatibleProvider({
    name: endpoint.provider === 'yandex' ? 'yandex' : 'openai-compatible',
    baseUrl: required(endpoint.baseUrl, baseName),
    model: required(endpoint.model, modelName),
    apiKey: endpoint.apiKey,
    project: endpoint.project,
    extraHeaders: endpoint.extraHeaders,
    profile,
    timeoutMs: config.llmTimeoutMs,
    temperature: config.llmTemperature,
    topP: config.llmTopP,
    topK: config.llmTopK,
  });
}

function generateEndpoint(config: AppConfig): Endpoint {
  return {
    provider: config.llmProvider,
    baseUrl: config.llmBaseUrl,
    model: config.llmModel,
    apiKey: config.llmApiKey,
    project: config.llmProject,
    extraHeaders: config.llmExtraHeaders,
    profile: config.llmProfile,
  };
}

function judgeEndpoint(config: AppConfig): Endpoint {
  return {
    provider: config.judgeProvider,
    baseUrl: config.judgeBaseUrl,
    model: config.judgeModel,
    apiKey: config.judgeApiKey,
    project: config.judgeProject,
    extraHeaders: config.judgeExtraHeaders,
    profile: config.judgeProfile,
  };
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
