import { z } from 'zod';
import { loadLocalEnv } from './load-env';

const portSchema = z.preprocess(
  (value: unknown) => (value === undefined || value === '' ? 3000 : value),
  z.coerce.number().int().min(1).max(65535),
);

const nodeEnvSchema = z.preprocess(
  (value: unknown) => (value === undefined || value === '' ? 'development' : value),
  z.enum(['development', 'test', 'production']),
);

const trustProxySchema = z.preprocess(
  (value: unknown) => (value === undefined || value === '' ? 0 : value),
  z.coerce.number().int().min(0).max(32),
);

const cookieSecureSchema = z.preprocess(
  (value: unknown) => (value === undefined || value === '' ? 'false' : value),
  z.enum(['true', 'false']).transform((value) => value === 'true'),
);

const blankToUndefined = (value: unknown) =>
  value === undefined || value === '' ? undefined : value;

const llmProviderSchema = z.preprocess(
  (value: unknown) => (value === undefined || value === '' ? 'none' : value),
  z.enum(['openai-compatible', 'gigachat', 'none']),
);

const optionalHttpUrl = z.preprocess(
  blankToUndefined,
  z
    .string()
    .regex(/^https?:\/\/\S+$/, 'ожидается http:// или https://')
    .optional(),
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
    LLM_TIMEOUT_MS: llmTimeoutSchema,
    LLM_CONCURRENCY: llmConcurrencySchema,
    GIGACHAT_AUTH_KEY: optionalText,
    GIGACHAT_SCOPE: gigachatScopeSchema,
    GIGACHAT_CA_FILE: optionalText,
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.COOKIE_SECURE !== true) {
      ctx.addIssue({
        code: 'custom',
        path: ['COOKIE_SECURE'],
        message: 'в production нужен true',
      });
    }
    if (env.LLM_PROVIDER === 'openai-compatible') {
      requireLlmField(ctx, env.LLM_BASE_URL, 'LLM_BASE_URL', 'нужен для openai-compatible');
      requireLlmField(ctx, env.LLM_MODEL, 'LLM_MODEL', 'нужен для openai-compatible');
    }
    if (env.LLM_PROVIDER === 'gigachat') {
      requireLlmField(ctx, env.GIGACHAT_AUTH_KEY, 'GIGACHAT_AUTH_KEY', 'нужен для gigachat');
      requireLlmField(
        ctx,
        env.GIGACHAT_CA_FILE,
        'GIGACHAT_CA_FILE',
        'нужен сертификат НУЦ Минцифры',
      );
      requireLlmField(ctx, env.LLM_MODEL, 'LLM_MODEL', 'нужен для gigachat');
    }
  })
  .transform((env) => ({
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
    cookieSecure: env.COOKIE_SECURE,
    trustProxy: env.TRUST_PROXY,
    webhookAllowedHosts: env.WEBHOOK_ALLOWED_HOSTS,
    llmProvider: env.LLM_PROVIDER,
    llmBaseUrl: env.LLM_BASE_URL,
    llmModel: env.LLM_MODEL,
    llmApiKey: env.LLM_API_KEY,
    llmTimeoutMs: env.LLM_TIMEOUT_MS,
    llmConcurrency: env.LLM_CONCURRENCY,
    gigachatAuthKey: env.GIGACHAT_AUTH_KEY,
    gigachatScope: env.GIGACHAT_SCOPE,
    gigachatCaFile: env.GIGACHAT_CA_FILE,
  }));

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
 * В адаптер всегда `false`. fastify 5.12.1 (GHSA-3m5p-2c4r-xxw2) убрал число
 * хопов из `trustProxy`: такое значение в рантайме не читает `X-Forwarded-*`.
 * Адреса прокси в env нет, подставлять hop-count обратно нельзя. Целое 0..32
 * остаётся в `AppConfig`, старый `TRUST_PROXY` не роняет старт.
 */
export function fastifyTrustProxy(_hops: number): false {
  return false;
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
