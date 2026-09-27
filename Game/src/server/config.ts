import { z } from 'zod';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 4174;

const environmentSchema = z.object({
  GAME_SERVER_HOST: z.string().min(1).optional(),
  GAME_SERVER_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  GAME_STATIC_DIR: z.string().min(1).optional(),
  PLATFORM_API_URL: z.string().url().optional(),
  PLATFORM_SERVICE_TOKEN: z.string().min(1).optional(),
  PLATFORM_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
  GAME_DISCONNECT_DEBOUNCE_MS: z.coerce.number().int().nonnegative().optional(),
  GAME_RECONNECT_GRACE_MS: z.coerce.number().int().positive().optional(),
  GAME_MOCK_ATTEMPT_ID: z.string().min(1).optional(),
  GAME_MOCK_LEVEL_ID: z.string().min(1).optional(),
  GAME_MOCK_MODE: z.enum(['live', 'guided']).optional(),
});

export interface ServerConfig {
  readonly host: string;
  readonly port: number;
  readonly staticClientDirectory: string | null;
  readonly platform: {
    readonly baseUrl: string;
    readonly serviceToken: string;
    readonly timeoutMs: number;
  } | null;
  readonly disconnectDebounceMs: number;
  readonly reconnectGraceMs: number;
  readonly mock: {
    readonly attemptId: string;
    readonly gameLevelId: string;
    readonly mode: 'live' | 'guided';
  };
}

export function parseServerConfig(environment: Record<string, string | undefined>): ServerConfig {
  const input = environmentSchema.parse(environment);
  return {
    host: input.GAME_SERVER_HOST ?? DEFAULT_HOST,
    port: input.GAME_SERVER_PORT ?? DEFAULT_PORT,
    staticClientDirectory: input.GAME_STATIC_DIR ?? null,
    platform: platformConfig(input),
    disconnectDebounceMs: input.GAME_DISCONNECT_DEBOUNCE_MS ?? 1_000,
    reconnectGraceMs: input.GAME_RECONNECT_GRACE_MS ?? 30_000,
    mock: {
      attemptId: input.GAME_MOCK_ATTEMPT_ID ?? 'local-attempt',
      gameLevelId: input.GAME_MOCK_LEVEL_ID ?? 'vsm-baseline-01',
      mode: input.GAME_MOCK_MODE ?? 'live',
    },
  };
}

function platformConfig(input: z.infer<typeof environmentSchema>): ServerConfig['platform'] {
  if (input.PLATFORM_API_URL === undefined && input.PLATFORM_SERVICE_TOKEN === undefined)
    return null;
  if (input.PLATFORM_API_URL === undefined || input.PLATFORM_SERVICE_TOKEN === undefined) {
    throw new Error('PLATFORM_API_URL and PLATFORM_SERVICE_TOKEN must be configured together');
  }
  return {
    baseUrl: input.PLATFORM_API_URL,
    serviceToken: input.PLATFORM_SERVICE_TOKEN,
    timeoutMs: input.PLATFORM_TIMEOUT_MS ?? 5_000,
  };
}
