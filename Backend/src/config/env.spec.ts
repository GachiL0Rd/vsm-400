import { describe, expect, it } from 'vitest';
import { fastifyTrustProxy, loadConfig } from './env';

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

  it('не принимает BOOTSTRAP_ADMIN_PASSWORD короче 10 и в production', () => {
    expect(() => loadConfig({ ...valid, BOOTSTRAP_ADMIN_PASSWORD: 'short' })).toThrow(/10/);
    expect(() =>
      loadConfig({
        ...valid,
        NODE_ENV: 'production',
        COOKIE_SECURE: 'true',
        BOOTSTRAP_ADMIN_PASSWORD: 'long-enough-password',
      }),
    ).toThrow(/production/);
    expect(
      loadConfig({
        ...valid,
        NODE_ENV: 'production',
        COOKIE_SECURE: 'true',
        BOOTSTRAP_ADMIN_PASSWORD: '   ',
      }).nodeEnv,
    ).toBe('production');
  });

  it('хранит число хопов, в Fastify заголовок не доверяет', () => {
    expect(loadConfig(valid).trustProxy).toBe(0);
    expect(fastifyTrustProxy(0)).toBe(false);
    expect(loadConfig({ ...valid, TRUST_PROXY: '2' }).trustProxy).toBe(2);
    expect(fastifyTrustProxy(2)).toBe(false);
    expect(() => loadConfig({ ...valid, TRUST_PROXY: '-1' })).toThrow(/TRUST_PROXY/);
  });

  it('в production требует COOKIE_SECURE=true', () => {
    expect(() => loadConfig({ ...valid, NODE_ENV: 'production', COOKIE_SECURE: 'false' })).toThrow(
      /COOKIE_SECURE/,
    );
    expect(() => loadConfig({ ...valid, NODE_ENV: 'production', COOKIE_SECURE: '' })).toThrow(
      /COOKIE_SECURE/,
    );
    expect(
      loadConfig({ ...valid, NODE_ENV: 'production', COOKIE_SECURE: 'true' }).cookieSecure,
    ).toBe(true);
    expect(
      loadConfig({ ...valid, NODE_ENV: 'development', COOKIE_SECURE: 'false' }).cookieSecure,
    ).toBe(false);
  });

  it('по умолчанию LLM выключен, gigachat без ключа не стартует', () => {
    const config = loadConfig(valid);
    expect(config.llmProvider).toBe('none');
    expect(config.llmTimeoutMs).toBe(90_000);
    expect(config.llmConcurrency).toBe(2);
    expect(config.llmTemperature).toBe(0.7);
    expect(config.llmProfile).toBe('llama-cpp');
    expect(config.gigachatBaseUrl).toBe('https://api.giga.chat');
    expect(config.judgeProvider).toBe('none');
    expect(config.llmTopP).toBe(0.8);
    expect(config.llmTopK).toBe(20);
    expect(config.llmJudge).toBe(true);
    expect(loadConfig({ ...valid, LLM_JUDGE: 'off' }).llmJudge).toBe(false);
    expect(
      loadConfig({ ...valid, LLM_TEMPERATURE: '0.4', LLM_TOP_P: '0.9', LLM_TOP_K: '40' }),
    ).toMatchObject({ llmTemperature: 0.4, llmTopP: 0.9, llmTopK: 40 });
    expect(config.gigachatScope).toBe('GIGACHAT_API_PERS');

    expect(() => loadConfig({ ...valid, LLM_PROVIDER: 'gigachat', LLM_MODEL: 'GigaChat' })).toThrow(
      /GIGACHAT_AUTH_KEY/,
    );
    expect(() =>
      loadConfig({
        ...valid,
        LLM_PROVIDER: 'gigachat',
        LLM_MODEL: 'GigaChat',
        GIGACHAT_AUTH_KEY: 'base64key',
      }),
    ).toThrow(/GIGACHAT_CA_FILE/);
    expect(() =>
      loadConfig({ ...valid, LLM_PROVIDER: 'openai-compatible', LLM_MODEL: 'local' }),
    ).toThrow(/LLM_BASE_URL/);

    const gigachat = loadConfig({
      ...valid,
      LLM_PROVIDER: 'gigachat',
      LLM_MODEL: 'GigaChat',
      GIGACHAT_AUTH_KEY: 'base64key',
      GIGACHAT_CA_FILE: '/tmp/ca.pem',
      GIGACHAT_SCOPE: 'GIGACHAT_API_B2B',
      LLM_CONCURRENCY: '4',
    });
    expect(gigachat.llmProvider).toBe('gigachat');
    expect(gigachat.gigachatAuthKey).toBe('base64key');
    expect(gigachat.gigachatScope).toBe('GIGACHAT_API_B2B');
    expect(gigachat.llmConcurrency).toBe(4);
    expect(gigachat.llmTemperature).toBe(1);
    expect(gigachat.judgeProvider).toBe('gigachat');
    expect(gigachat.judgeModel).toBe('GigaChat');

    const pers = loadConfig({
      ...valid,
      LLM_PROVIDER: 'gigachat',
      LLM_MODEL: 'GigaChat-2-Max',
      GIGACHAT_AUTH_KEY: 'base64key',
      GIGACHAT_CA_FILE: '/tmp/ca.pem',
      LLM_CONCURRENCY: '8',
    });
    expect(pers.gigachatScope).toBe('GIGACHAT_API_PERS');
    expect(pers.llmConcurrency).toBe(1);
    expect(pers.llmTemperature).toBe(1);
  });

  it('yandex — алиас с дефолтной базой, судья может быть другим', () => {
    expect(() =>
      loadConfig({ ...valid, LLM_PROVIDER: 'yandex', LLM_MODEL: 'aliceai-llm-flash' }),
    ).toThrow(/LLM_API_KEY/);
    expect(() =>
      loadConfig({
        ...valid,
        LLM_PROVIDER: 'yandex',
        LLM_MODEL: 'aliceai-llm-flash',
        LLM_API_KEY: 'key',
      }),
    ).toThrow(/LLM_PROJECT/);

    const yandex = loadConfig({
      ...valid,
      LLM_PROVIDER: 'yandex',
      LLM_MODEL: 'aliceai-llm-flash',
      LLM_API_KEY: 'key',
      LLM_PROJECT: 'folder1',
      LLM_EXTRA_HEADERS: '{"X-Title":"vsm"}',
    });
    expect(yandex.llmProvider).toBe('yandex');
    expect(yandex.llmBaseUrl).toBe('https://ai.api.cloud.yandex.net/v1');
    expect(yandex.llmProfile).toBe('yandex');
    expect(yandex.llmTemperature).toBe(1);
    expect(yandex.llmProject).toBe('folder1');
    expect(yandex.llmExtraHeaders).toEqual({ 'X-Title': 'vsm' });
    expect(yandex.judgeProvider).toBe('yandex');
    expect(yandex.judgeModel).toBe('aliceai-llm-flash');
    expect(yandex.judgeApiKey).toBe('key');
    expect(yandex.llmConcurrency).toBe(2);

    const uri = loadConfig({
      ...valid,
      LLM_PROVIDER: 'yandex',
      LLM_MODEL: 'gpt://folder1/aliceai-llm-flash/latest',
      LLM_API_KEY: 'key',
      LLM_TEMPERATURE: '0.4',
    });
    expect(uri.llmModel).toBe('gpt://folder1/aliceai-llm-flash/latest');
    expect(uri.llmTemperature).toBe(0.4);

    expect(() =>
      loadConfig({
        ...valid,
        LLM_PROVIDER: 'yandex',
        LLM_MODEL: 'aliceai-llm-flash',
        LLM_API_KEY: 'key',
        LLM_PROJECT: 'folder1',
        LLM_JUDGE_PROVIDER: 'gigachat',
      }),
    ).toThrow(/LLM_JUDGE_MODEL/);

    const split = loadConfig({
      ...valid,
      LLM_PROVIDER: 'yandex',
      LLM_MODEL: 'aliceai-llm-flash',
      LLM_API_KEY: 'key',
      LLM_PROJECT: 'folder1',
      LLM_JUDGE_PROVIDER: 'gigachat',
      LLM_JUDGE_MODEL: 'GigaChat-2-Max',
      GIGACHAT_AUTH_KEY: 'base64key',
      GIGACHAT_CA_FILE: '/tmp/ca.pem',
    });
    expect(split.judgeProvider).toBe('gigachat');
    expect(split.judgeModel).toBe('GigaChat-2-Max');
    expect(split.judgeProfile).toBe('llama-cpp');
    expect(split.llmProfile).toBe('yandex');

    expect(() => loadConfig({ ...valid, LLM_EXTRA_HEADERS: 'nope' })).toThrow(/LLM_EXTRA_HEADERS/);
    expect(
      loadConfig({
        ...valid,
        LLM_PROVIDER: 'openai-compatible',
        LLM_BASE_URL: 'http://127.0.0.1:8081',
        LLM_MODEL: 'qwen3-8b',
        LLM_PROFILE: 'vllm',
      }).llmProfile,
    ).toBe('vllm');
  });

  it('разбирает allowlist вебхуков и считает пустое значение открытым', () => {
    expect(loadConfig(valid).webhookAllowedHosts).toEqual([]);
    expect(
      loadConfig({ ...valid, WEBHOOK_ALLOWED_HOSTS: ' LMS.Example. , https://hooks.test/path ' })
        .webhookAllowedHosts,
    ).toEqual(['lms.example', 'hooks.test']);
  });
});
