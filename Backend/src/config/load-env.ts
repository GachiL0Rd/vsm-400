import { existsSync } from 'node:fs';

/** Подмешивает .env, не затирая уже заданные переменные. */
export function loadLocalEnv(): void {
  if (existsSync('.env')) {
    process.loadEnvFile('.env');
  }
}
