import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { finishedGameResultSchema } from '../src/server/finished-game-result.schema.ts';
import { generateSampleResults, serializeSampleResults } from './generate-sample-results.ts';

describe('sample results for platform demos', () => {
  it('matches the platform result schema and stays byte-identical for the same seeds', () => {
    const first = serializeSampleResults(generateSampleResults());
    const second = serializeSampleResults(generateSampleResults());
    expect(second).toBe(first);

    const parsed: unknown = JSON.parse(first);
    expect(Array.isArray(parsed)).toBe(true);
    if (!Array.isArray(parsed)) return;
    expect(parsed.length).toBeGreaterThanOrEqual(40);
    expect(parsed.length).toBeLessThanOrEqual(60);
    for (const result of parsed) {
      const body = finishedGameResultSchema.parse(result);
      expect(body.attemptId).toBe('placeholder');
      expect(body.content.gameLevelId).toBe('vsm-train2-01');
      expect(body.assessment?.facts.length).toBeGreaterThan(0);
    }

    const committed = readFileSync(
      new URL('../../Backend/prisma/seed/fixtures/game-results.json', import.meta.url),
      'utf8',
    );
    expect(committed).toBe(first);
  }, 180_000);
});
