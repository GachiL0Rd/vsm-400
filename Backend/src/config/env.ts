import { isIP } from 'node:net';
import { z } from 'zod';
import {
  GIGACHAT_DEFAULT_BASE_URL,
  type LlmApiProfile,
  type LlmProviderName,
  YANDEX_DEFAULT_BASE_URL,
} from '../llm/llm.constants';
import { effectiveLlmConcurrency } from './llm-concurrency';
import { loadLocalEnv } from './load-env';

const portSchema = z.preprocess(
  (value: unknown) => (value === undefined || value === '' ? 3000 : value),
  z.coerce.number().int().min(1).max(65535),
);

const nodeEnvSchema = z.preprocess(
  (value: unknown) => (value === undefined || value === '' ? 'development' : value),
  z.enum(['development', 'test', 'production']),
);

const proxyKeywords = new Set(['loopback', 'linklocal', 'uniquelocal']);

function normalizeTrustProxyInput(value: unknown): unknown {
  if (value === undefined || value === null || value === false) {
    return false;
  }
  if (value === true) {
    return 'true';
  }
  if (typeof value === 'number') {
    return value === 0 ? false : String(value);
  }
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();
  if (trimmed === '' || lower === 'false' || trimmed === '0') {
    return false;
  }
  if (lower === 'true') {
    return 'true';
  }
  return trimmed;
}

const hopCountMessage =
  'true и число хопов запрещены: укажите IP, CIDR или loopback, linklocal, uniquelocal';

/**
 * Пусто, false и 0 — не доверять X-Forwarded-For.
 * Иначе список IP, CIDR или ключевых слов proxy-addr.
 * true и число хопов Fastify 5.12 закрывает: заголовок тогда не читается.
 * Текст ошибки вешаем после union: иначе Zod оставляет «Invalid input».
 */
const trustProxySchema = z
  .preprocess(normalizeTrustProxyInput, z.union([z.literal(false), z.string()]))
  .superRefine((value, ctx) => {
    if (value === false) {
      return;
    }
    if (value.toLowerCase() === 'true' || /^\d+$/.test(value)) {
      ctx.addIssue({ code: 'custom', message: hopCountMessage });
      return;
    }
    const parts = value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    if (parts.length === 0) {
      ctx.addIssue({ code: 'custom', message: 'пустой список' });
      return;
    }
    for (const part of parts) {
      if (!trustProxyToken(part)) {
        ctx.addIssue({
          code: 'custom',
          message: `«${part}» не IP, не CIDR и не ключевое слово proxy-addr`,
        });
      }
    }
  })
  .transform((value): false | string => {
    if (value === false) {
      return false;
    }
    return value
      .split(',')
      .map((item) => normalizeTrustToken(item.trim()))
      .filter((item) => item.length > 0)
      .join(',');
  });

function normalizeTrustToken(token: string): string {
  const lower = token.toLowerCase();
  return proxyKeywords.has(lower) ? lower : token;
}

function trustProxyToken(token: string): boolean {
  if (proxyKeywords.has(token.toLowerCase())) {
    return true;
  }
  if (isIP(token) !== 0) {
    return true;
  }
  return cidrToken(token);
}

function cidrToken(token: string): boolean {
  const slash = token.lastIndexOf('/');
  if (slash <= 0) {
    return false;
  }
  const addr = token.slice(0, slash);
  const prefix = Number(token.slice(slash + 1));
  const family = isIP(addr);
  if (!Number.isInteger(prefix)) {
    return false;
  }
  if (family === 4) {
    return prefix >= 0 && prefix <= 32;
  }
  if (family === 6) {
    return prefix >= 0 && prefix <= 128;
  }
  return false;
}

const cookieSecureSchema = z.preprocess(
  (value: unknown) => (value === undefined || value === '' ? 'false' : value),
  z.enum(['true', 'false']).transform((value) => value === 'true'),
);

const blankToUndefined = (value: unknown) =>
  value === undefined || value === '' ? undefined : value;

const llmProviderSchema = z.preprocess(
  (value: unknown) => (value === undefined || value === '' ? 'none' : value),
  z.enum(['openai-compatible', 'gigachat', 'yandex', 'none']),
);

const optionalLlmProviderSchema = z.preprocess(
  blankToUndefined,
  z.enum(['openai-compatible', 'gigachat', 'yandex', 'none']).optional(),
);

const optionalHttpUrl = z.preprocess(
  blankToUndefined,
  z
    .string()
    .regex(/^https?:\/\/\S+$/, 'ожидается http:// или https://')
    .optional(),
);

const DEFAULT_GAME_LEVEL_ID = 'vsm-baseline-01';
const DEFAULT_PUBLIC_GAME_URL = 'http://127.0.0.1:4174/';
const DEFAULT_PUBLIC_APP_URL = 'http://127.0.0.1:5173';

const absoluteHttpUrl = z.string().superRefine((value, ctx) => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    ctx.addIssue({ code: 'custom', message: 'ожидается абсолютный http:// или https://' });
    return;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    ctx.addIssue({ code: 'custom', message: 'ожидается абсолютный http:// или https://' });
  }
});

function httpUrlDefault(fallback: string) {
  return z.preprocess(
    (value: unknown) => (value === undefined || value === '' ? fallback : value),
    absoluteHttpUrl,
  );
}

const gameLevelIdSchema = z.preprocess(
  (value: unknown) => (value === undefined || value === '' ? DEFAULT_GAME_LEVEL_ID : value),
  z.string().min(1),
);

const optionalText = z.preprocess(blankToUndefined, z.string().min(1).optional());

const llmTimeoutSchema = z.preprocess(
  (value: unknown) => (value === undefined || value === '' ? 90_000 : value),
  z.coerce.number().int().min(1_000).max(180_000),
);

const llmConcurrencySchema = z.preprocess(
  (value: unknown) => (value === undefined || value === '' ? 2 : value),
  z.coerce.number().int().min(1).max(32),
);

const llmTemperatureSchema = z.preprocess(
  blankToUndefined,
  z.coerce.number().min(0).max(2).optional(),
);

const llmProfileSchema = z.preprocess(
  blankToUndefined,
  z.enum(['llama-cpp', 'vllm', 'yandex']).optional(),
);

const extraHeadersSchema = z.preprocess((value: unknown) => {
  if (value === undefined || value === '') {
    return undefined;
  }
  if (typeof value !== 'string') {
    return value;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}, z.record(z.string(), z.string()).optional());

const gigachatBaseSchema = z.preprocess(
  (value: unknown) => (value === undefined || value === '' ? GIGACHAT_DEFAULT_BASE_URL : value),
  z.string().regex(/^https:\/\/\S+$/, 'ожидается https://'),
);

const llmTopPSchema = z.preprocess(
  (value: unknown) => (value === undefined || value === '' ? 0.8 : value),
  z.coerce.number().gt(0).lte(1),
);

const llmTopKSchema = z.preprocess(
  (value: unknown) => (value === undefined || value === '' ? 20 : value),
  z.coerce.number().int().min(1).max(200),
);

const llmJudgeSchema = z.preprocess((value: unknown) => {
  if (value === undefined || value === '') {
    return true;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (
      normalized === 'false' ||
      normalized === '0' ||
      normalized === 'off' ||
      normalized === 'no'
    ) {
      return false;
    }
    if (
      normalized === 'true' ||
      normalized === '1' ||
      normalized === 'on' ||
      normalized === 'yes'
    ) {
      return true;
    }
  }
  return value;
}, z.boolean());

const gigachatScopeSchema = z.preprocess(
  (value: unknown) => (value === undefined || value === '' ? 'GIGACHAT_API_PERS' : value),
  z.enum(['GIGACHAT_API_PERS', 'GIGACHAT_API_B2B', 'GIGACHAT_API_CORP']),
);

const EnvSchema = z
  .object({
    NODE_ENV: nodeEnvSchema,
    PORT: portSchema,
    DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\/\S+$/, 'ожидается postgres://'),
    REDIS_URL: z.string().regex(/^rediss?:\/\/\S+$/, 'ожидается redis://'),
    JWT_ACCESS_SECRET: z.string().min(32, 'минимум 32 символа'),
    GAME_TICKET_SECRET: z.string().min(32, 'минимум 32 символа'),
    GAME_SERVER_TOKEN: z.string().min(16, 'минимум 16 символов'),
    SEED_ENC_KEY: z
      .string()
      .regex(/^[0-9a-fA-F]{64}$/, 'нужны 32 байта в hex (64 символа) для AES-256-GCM'),
    EXT_ID_PEPPER: z.string().min(16, 'минимум 16 символов'),
    CORS_ORIGINS: z
      .string()
      .min(1)
      .transform((value) =>
        value
          .split(',')
          .map((item) => item.trim())
          .filter((item) => item.length > 0),
      )
      .refine((value) => value.length > 0, { message: 'нужен хотя бы один origin' }),
    PUBLIC_GAME_WS_URL: z.string().regex(/^wss?:\/\/\S+$/, 'ожидается ws:// или wss://'),
    PUBLIC_GAME_URL: httpUrlDefault(DEFAULT_PUBLIC_GAME_URL),
    PUBLIC_APP_URL: httpUrlDefault(DEFAULT_PUBLIC_APP_URL),
    GAME_LEVEL_ID: gameLevelIdSchema,
    COOKIE_SECURE: cookieSecureSchema,
    TRUST_PROXY: trustProxySchema,
    WEBHOOK_ALLOWED_HOSTS: z.preprocess(
      (value: unknown) => (value === undefined || value === '' ? '' : value),
      z.string().transform((value) =>
        value
          .split(',')
          .map((item) => normalizeWebhookHost(item))
          .filter((item) => item.length > 0),
      ),
    ),
    LLM_PROVIDER: llmProviderSchema,
    LLM_BASE_URL: optionalHttpUrl,
    LLM_MODEL: optionalText,
    LLM_API_KEY: optionalText,
    LLM_PROJECT: optionalText,
    LLM_PROFILE: llmProfileSchema,
    LLM_EXTRA_HEADERS: extraHeadersSchema,
    LLM_TIMEOUT_MS: llmTimeoutSchema,
    LLM_CONCURRENCY: llmConcurrencySchema,
    LLM_TEMPERATURE: llmTemperatureSchema,
    LLM_TOP_P: llmTopPSchema,
    LLM_TOP_K: llmTopKSchema,
    LLM_JUDGE: llmJudgeSchema,
    LLM_JUDGE_PROVIDER: optionalLlmProviderSchema,
    LLM_JUDGE_BASE_URL: optionalHttpUrl,
    LLM_JUDGE_MODEL: optionalText,
    LLM_JUDGE_API_KEY: optionalText,
    LLM_JUDGE_PROJECT: optionalText,
    LLM_JUDGE_PROFILE: llmProfileSchema,
    LLM_JUDGE_EXTRA_HEADERS: extraHeadersSchema,
    GIGACHAT_AUTH_KEY: optionalText,
    GIGACHAT_SCOPE: gigachatScopeSchema,
    GIGACHAT_CA_FILE: optionalText,
    GIGACHAT_BASE_URL: gigachatBaseSchema,
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.COOKIE_SECURE !== true) {
      ctx.addIssue({
        code: 'custom',
        path: ['COOKIE_SECURE'],
        message: 'в production нужен true',
      });
    }
    const judge = judgeSlice(env);
    checkChat(ctx, generateSlice(env), {
      base: 'LLM_BASE_URL',
      model: 'LLM_MODEL',
      apiKey: 'LLM_API_KEY',
      project: 'LLM_PROJECT',
    });
    if (judge.provider !== env.LLM_PROVIDER) {
      checkChat(ctx, judge, {
        base: 'LLM_JUDGE_BASE_URL',
        model: 'LLM_JUDGE_MODEL',
        apiKey: 'LLM_JUDGE_API_KEY',
        project: 'LLM_JUDGE_PROJECT',
      });
    }
    if (env.LLM_PROVIDER === 'gigachat' || judge.provider === 'gigachat') {
      requireLlmField(ctx, env.GIGACHAT_AUTH_KEY, 'GIGACHAT_AUTH_KEY', 'нужен для gigachat');
      requireLlmField(
        ctx,
        env.GIGACHAT_CA_FILE,
        'GIGACHAT_CA_FILE',
        'нужен сертификат НУЦ Минцифры',
      );
    }
  })
  .transform((env) => {
    const judge = judgeSlice(env);
    return {
      nodeEnv: env.NODE_ENV,
      port: env.PORT,
      databaseUrl: env.DATABASE_URL,
      redisUrl: env.REDIS_URL,
      jwtAccessSecret: env.JWT_ACCESS_SECRET,
      gameTicketSecret: env.GAME_TICKET_SECRET,
      gameServerToken: env.GAME_SERVER_TOKEN,
      seedEncKey: env.SEED_ENC_KEY,
      extIdPepper: env.EXT_ID_PEPPER,
      corsOrigins: env.CORS_ORIGINS,
      publicGameWsUrl: env.PUBLIC_GAME_WS_URL,
      publicGameUrl: env.PUBLIC_GAME_URL,
      publicAppUrl: env.PUBLIC_APP_URL,
      gameLevelId: env.GAME_LEVEL_ID,
      cookieSecure: env.COOKIE_SECURE,
      trustProxy: env.TRUST_PROXY,
      webhookAllowedHosts: env.WEBHOOK_ALLOWED_HOSTS,
      llmProvider: env.LLM_PROVIDER,
      llmBaseUrl: withDefaultBase(env.LLM_PROVIDER, env.LLM_BASE_URL),
      llmModel: env.LLM_MODEL,
      llmApiKey: env.LLM_API_KEY,
      llmProject: env.LLM_PROJECT,
      llmExtraHeaders: env.LLM_EXTRA_HEADERS,
      llmProfile: resolveProfile(env.LLM_PROVIDER, env.LLM_PROFILE),
      llmTimeoutMs: env.LLM_TIMEOUT_MS,
      llmConcurrency: effectiveLlmConcurrency(
        env.LLM_PROVIDER,
        env.GIGACHAT_SCOPE,
        env.LLM_CONCURRENCY,
      ),
      llmTemperature: env.LLM_TEMPERATURE ?? defaultTemperature(env.LLM_PROVIDER),
      llmTopP: env.LLM_TOP_P,
      llmTopK: env.LLM_TOP_K,
      llmJudge: env.LLM_JUDGE,
      gigachatAuthKey: env.GIGACHAT_AUTH_KEY,
      gigachatScope: env.GIGACHAT_SCOPE,
      gigachatCaFile: env.GIGACHAT_CA_FILE,
      gigachatBaseUrl: env.GIGACHAT_BASE_URL,
      judgeProvider: judge.provider,
      judgeBaseUrl: withDefaultBase(judge.provider, judge.baseUrl),
      judgeModel: judge.model,
      judgeApiKey: judge.apiKey,
      judgeProject: judge.project,
      judgeExtraHeaders: judge.extraHeaders,
      judgeProfile: resolveProfile(judge.provider, judge.profile),
    };
  });

type ChatFields = {
  provider: LlmProviderName;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  project?: string;
  extraHeaders?: Record<string, string>;
  profile?: LlmApiProfile;
};

type LlmEnvSlice = {
  LLM_PROVIDER: LlmProviderName;
  LLM_BASE_URL?: string;
  LLM_MODEL?: string;
  LLM_API_KEY?: string;
  LLM_PROJECT?: string;
  LLM_PROFILE?: LlmApiProfile;
  LLM_EXTRA_HEADERS?: Record<string, string>;
  LLM_JUDGE_PROVIDER?: LlmProviderName;
  LLM_JUDGE_BASE_URL?: string;
  LLM_JUDGE_MODEL?: string;
  LLM_JUDGE_API_KEY?: string;
  LLM_JUDGE_PROJECT?: string;
  LLM_JUDGE_PROFILE?: LlmApiProfile;
  LLM_JUDGE_EXTRA_HEADERS?: Record<string, string>;
};

function generateSlice(env: LlmEnvSlice): ChatFields {
  return {
    provider: env.LLM_PROVIDER,
    baseUrl: env.LLM_BASE_URL,
    model: env.LLM_MODEL,
    apiKey: env.LLM_API_KEY,
    project: env.LLM_PROJECT,
    extraHeaders: env.LLM_EXTRA_HEADERS,
    profile: env.LLM_PROFILE,
  };
}

function judgeSlice(env: LlmEnvSlice): ChatFields {
  const provider = env.LLM_JUDGE_PROVIDER ?? env.LLM_PROVIDER;
  const same = provider === env.LLM_PROVIDER;
  return {
    provider,
    baseUrl: env.LLM_JUDGE_BASE_URL ?? (same ? env.LLM_BASE_URL : undefined),
    model: env.LLM_JUDGE_MODEL ?? (same ? env.LLM_MODEL : undefined),
    apiKey: env.LLM_JUDGE_API_KEY ?? (same ? env.LLM_API_KEY : undefined),
    project: env.LLM_JUDGE_PROJECT ?? (same ? env.LLM_PROJECT : undefined),
    extraHeaders: env.LLM_JUDGE_EXTRA_HEADERS ?? (same ? env.LLM_EXTRA_HEADERS : undefined),
    profile: env.LLM_JUDGE_PROFILE ?? (same ? env.LLM_PROFILE : undefined),
  };
}

function withDefaultBase(provider: LlmProviderName, baseUrl?: string): string | undefined {
  if (baseUrl) {
    return baseUrl;
  }
  if (provider === 'yandex') {
    return YANDEX_DEFAULT_BASE_URL;
  }
  return undefined;
}

function resolveProfile(provider: LlmProviderName, explicit?: LlmApiProfile): LlmApiProfile {
  if (explicit) {
    return explicit;
  }
  if (provider === 'yandex') {
    return 'yandex';
  }
  return 'llama-cpp';
}

function defaultTemperature(provider: LlmProviderName): number {
  if (provider === 'gigachat' || provider === 'yandex') {
    return 1;
  }
  return 0.7;
}

function checkChat(
  ctx: z.RefinementCtx,
  fields: ChatFields,
  names: { base: string; model: string; apiKey: string; project: string },
): void {
  if (fields.provider === 'none') {
    return;
  }
  if (fields.provider === 'gigachat') {
    requireLlmField(ctx, fields.model, names.model, 'нужен для gigachat');
    return;
  }
  if (fields.provider === 'openai-compatible') {
    requireLlmField(ctx, fields.baseUrl, names.base, 'нужен для openai-compatible');
    requireLlmField(ctx, fields.model, names.model, 'нужен для openai-compatible');
    return;
  }
  requireLlmField(ctx, fields.model, names.model, 'нужен для yandex');
  requireLlmField(ctx, fields.apiKey, names.apiKey, 'нужен для yandex');
  if (fields.model !== undefined && !fields.model.startsWith('gpt://')) {
    requireLlmField(ctx, fields.project, names.project, 'нужен folder для URI модели');
  }
}

function requireLlmField(
  ctx: z.RefinementCtx,
  value: string | undefined,
  path: string,
  message: string,
): void {
  if (value === undefined) {
    ctx.addIssue({ code: 'custom', path: [path], message });
  }
}

function normalizeWebhookHost(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length === 0) {
    return '';
  }
  if (trimmed.includes('://')) {
    try {
      return bareHost(new URL(trimmed).hostname);
    } catch {
      return '';
    }
  }
  return bareHost(trimmed);
}

function bareHost(hostname: string): string {
  const stripped = hostname.replace(/\.$/, '');
  if (stripped.startsWith('[') && stripped.endsWith(']')) {
    return stripped.slice(1, -1);
  }
  return stripped;
}

export type AppConfig = z.output<typeof EnvSchema>;

export const APP_CONFIG = Symbol('APP_CONFIG');

export class EnvConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvConfigError';
  }
}

function formatEnvError(error: z.ZodError): string {
  const lines = error.issues.map((issue) => {
    const path = issue.path.map(String).join('.') || 'корень';
    return `- ${path}: ${issue.message}`;
  });
  return `Некорректное окружение:\n${lines.join('\n')}`;
}

/**
 * Падает с понятным текстом, если env не совпал со схемой.
 * Явный source нужен тестам: .env с диска при этом не читается.
 */
export function loadConfig(source?: NodeJS.ProcessEnv): AppConfig {
  if (!source) {
    loadLocalEnv();
  }
  const parsed = EnvSchema.safeParse(source ?? process.env);
  if (!parsed.success) {
    throw new EnvConfigError(formatEnvError(parsed.error));
  }
  assertBootstrapPassword(source ?? process.env, parsed.data.nodeEnv);
  return parsed.data;
}

function assertBootstrapPassword(source: NodeJS.ProcessEnv, nodeEnv: AppConfig['nodeEnv']): void {
  const raw = source.BOOTSTRAP_ADMIN_PASSWORD;
  if (typeof raw !== 'string' || raw.trim() === '') {
    return;
  }
  if (nodeEnv === 'production') {
    throw new EnvConfigError('BOOTSTRAP_ADMIN_PASSWORD запрещён в production');
  }
  if (raw.trim().length < 10) {
    throw new EnvConfigError('BOOTSTRAP_ADMIN_PASSWORD короче 10 символов');
  }
}
