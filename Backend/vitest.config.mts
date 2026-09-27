import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';
import { redisSharesOneDb } from './test/databases.ts';

const devKey = 'a'.repeat(64);

// DATABASE_URL и REDIS_URL не подменяем: их даёт CI или Backend/.env.
// Зашитый localhost:5432 уводил globalSetup мимо порта docker.
const sharedEnv = {
  NODE_ENV: 'test',
  PORT: '3000',
  JWT_ACCESS_SECRET: 'local-dev-jwt-access-secret-32chars',
  GAME_TICKET_SECRET: 'local-dev-game-ticket-secret-32ch',
  GAME_SERVER_TOKEN: 'local-dev-game-server-token',
  SEED_ENC_KEY: devKey,
  EXT_ID_PEPPER: 'local-dev-ext-id-pepper',
  CORS_ORIGINS: 'http://127.0.0.1:5173',
  PUBLIC_GAME_WS_URL: 'ws://127.0.0.1:3001/game',
  COOKIE_SECURE: 'false',
  LLM_PROVIDER: 'none',
};

const dbFiles = [
  'src/cabinet/cabinet.http.spec.ts',
  'src/progression/progression.integration.spec.ts',
  'test/auth.e2e-spec.ts',
  'test/scenarios.e2e-spec.ts',
  'test/sessions.e2e-spec.ts',
  'test/llm.e2e-spec.ts',
  'test/seed.e2e-spec.ts',
];

export default defineConfig({
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2023',
        parser: {
          syntax: 'typescript',
          decorators: true,
        },
        transform: {
          legacyDecorator: true,
          decoratorMetadata: true,
        },
      },
    }),
  ],
  test: {
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    env: sharedEnv,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: [
            'src/**/*.spec.ts',
            'test/**/*.spec.ts',
            'test/health.e2e-spec.ts',
            'test/integration.e2e-spec.ts',
          ],
          exclude: ['**/node_modules/**', '**/dist/**', '**/.git/**', ...dbFiles],
          env: {
            ...sharedEnv,
            DATABASE_URL: 'postgresql://vsm@127.0.0.1:5432/vsm',
            REDIS_URL: 'redis://127.0.0.1:6379/0',
          },
        },
      },
      {
        extends: true,
        test: {
          name: 'db',
          include: dbFiles,
          // Один номер Redis на все наборы: FLUSHDB в auth сотрёт ключи соседа.
          fileParallelism: !redisSharesOneDb(),
          globalSetup: ['./test/global-setup.ts'],
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
