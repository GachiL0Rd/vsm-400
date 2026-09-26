import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

const devKey = 'a'.repeat(64);

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
    include: ['src/**/*.spec.ts', 'test/**/*.e2e-spec.ts'],
    setupFiles: ['./test/setup.ts'],
    env: {
      NODE_ENV: 'test',
      PORT: '3000',
      DATABASE_URL: 'postgresql://vsm@127.0.0.1:5432/vsm',
      REDIS_URL: 'redis://127.0.0.1:6379',
      JWT_ACCESS_SECRET: 'local-dev-jwt-access-secret-32chars',
      GAME_TICKET_SECRET: 'local-dev-game-ticket-secret-32ch',
      GAME_SERVER_TOKEN: 'local-dev-game-server-token',
      SEED_ENC_KEY: devKey,
      EXT_ID_PEPPER: 'local-dev-ext-id-pepper',
      CORS_ORIGINS: 'http://127.0.0.1:5173',
      PUBLIC_GAME_WS_URL: 'ws://127.0.0.1:3001/game',
      COOKIE_SECURE: 'false',
    },
  },
});
