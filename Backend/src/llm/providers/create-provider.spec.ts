import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../config/env';
import { createLlmProvider, type RedisTokenStore } from './create-provider';

const valid = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://vsm@127.0.0.1:5432/vsm',
  REDIS_URL: 'redis://127.0.0.1:6379',
  JWT_ACCESS_SECRET: 'local-dev-jwt-access-secret-32chars',
  GAME_TICKET_SECRET: 'local-dev-game-ticket-secret-32ch',
  GAME_SERVER_TOKEN: 'local-dev-game-server-token',
  SEED_ENC_KEY: 'a'.repeat(64),
  EXT_ID_PEPPER: 'local-dev-ext-id-pepper',
  CORS_ORIGINS: 'http://127.0.0.1:5173',
  PUBLIC_GAME_WS_URL: 'ws://127.0.0.1:3001/game',
  COOKIE_SECURE: 'true',
};

const redis: RedisTokenStore = {
  get: async () => null,
  set: async () => undefined,
};

describe('createLlmProvider', () => {
  it('yandex и gigachat-судья собираются из одного конфига', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vsm-ca-'));
    const caFile = join(dir, 'ca.pem');
    writeFileSync(caFile, 'not-a-real-cert');
    const config = loadConfig({
      ...valid,
      LLM_PROVIDER: 'yandex',
      LLM_MODEL: 'aliceai-llm-flash',
      LLM_API_KEY: 'key',
      LLM_PROJECT: 'folder1',
      LLM_JUDGE_PROVIDER: 'gigachat',
      LLM_JUDGE_MODEL: 'GigaChat-2-Max',
      GIGACHAT_AUTH_KEY: 'base64key',
      GIGACHAT_CA_FILE: caFile,
    });
    expect(createLlmProvider(config, redis).name).toBe('yandex');
    expect(createLlmProvider(config, redis, 'judge').name).toBe('gigachat');
  });
});
