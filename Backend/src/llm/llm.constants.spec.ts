import { describe, expect, it } from 'vitest';
import { workerConcurrency } from './llm.constants';

describe('workerConcurrency', () => {
  it('PERS всегда один поток, B2B и yandex берут LLM_CONCURRENCY', () => {
    expect(workerConcurrency({ LLM_PROVIDER: 'gigachat', LLM_CONCURRENCY: '8' })).toBe(1);
    expect(
      workerConcurrency({
        LLM_PROVIDER: 'gigachat',
        GIGACHAT_SCOPE: 'GIGACHAT_API_B2B',
        LLM_CONCURRENCY: '4',
      }),
    ).toBe(4);
    expect(workerConcurrency({ LLM_PROVIDER: 'yandex', LLM_CONCURRENCY: '2' })).toBe(2);
    expect(workerConcurrency({})).toBe(2);
  });
});
