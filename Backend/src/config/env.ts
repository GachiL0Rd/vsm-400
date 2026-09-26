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
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.COOKIE_SECURE !== true) {
      ctx.addIssue({
        code: 'custom',
        path: ['COOKIE_SECURE'],
        message: 'в production нужен true',
      });
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
  }));

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
/** 0 — не верить X-Forwarded-For. Иначе число прокси перед приложением. */
export function fastifyTrustProxy(hops: number): number | false {
  return hops > 0 ? hops : false;
}

export function loadConfig(source?: NodeJS.ProcessEnv): AppConfig {
  if (!source) {
    loadLocalEnv();
  }
  const parsed = EnvSchema.safeParse(source ?? process.env);
  if (!parsed.success) {
    throw new EnvConfigError(formatEnvError(parsed.error));
  }
  return parsed.data;
}
