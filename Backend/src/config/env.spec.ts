import { describe, expect, it } from 'vitest';
import { loadConfig } from './env';

const valid = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://vsm@127.0.0.1:5432/vsm',
  REDIS_URL: 'redis://127.0.0.1:6379',
  JWT_ACCESS_SECRET: 'local-dev-jwt-access-secret-32chars',
  GAME_TICKET_SECRET: 'local-dev-game-ticket-secret-32ch',
  GAME_SERVER_TOKEN: 'local-dev-game-server-token',
  SEED_ENC_KEY: 'a'.repeat(64),
  EXT_ID_PEPPER: 'local-dev-ext-id-pepper',
  CORS_ORIGINS: 'http://127.0.0.1:5173, http://localhost:5173',
  PUBLIC_GAME_WS_URL: 'ws://127.0.0.1:3001/game',
  COOKIE_SECURE: 'true',
};

describe('loadConfig', () => {
  it('ставит PORT 3000 и разбирает CORS', () => {
    const config = loadConfig(valid);
    expect(config.port).toBe(3000);
    expect(config.cookieSecure).toBe(true);
    expect(config.corsOrigins).toEqual(['http://127.0.0.1:5173', 'http://localhost:5173']);
    expect(config.seedEncKey).toHaveLength(64);
  });

  it('падает, если нет DATABASE_URL', () => {
    const { DATABASE_URL: _removed, ...rest } = valid;
    expect(() => loadConfig(rest)).toThrow(/DATABASE_URL/);
  });

  it('не принимает короткий ключ AES', () => {
    expect(() => loadConfig({ ...valid, SEED_ENC_KEY: 'abcd' })).toThrow(/SEED_ENC_KEY/);
  });
});
