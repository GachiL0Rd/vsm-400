import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BASELINE_ASSESSMENT_CONFIG } from '../simulation/assessment-config.ts';
import { BASELINE_ACTION_CONTENT } from '../simulation/baseline-content.ts';
import { BASELINE_LEVEL_DEFINITION } from '../simulation/level.ts';
import { BASELINE_SCENARIO_DEFINITION } from '../simulation/scenario.ts';
import { FileGameContentRegistry } from './content-registry.ts';

const contentDirectory = fileURLToPath(new URL('../../content/', import.meta.url));

function json(relativePath: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`../../content/${relativePath}`, import.meta.url), 'utf8'),
  );
}

describe('FileGameContentRegistry', () => {
  it('loads the release baseline bundle from files', () => {
    const content = new FileGameContentRegistry(contentDirectory).resolve('vsm-baseline-01');
    expect(content.gameLevelVersion).toBe('vsm-baseline-01');
    expect(content.simulationCompatibilityVersion).toBe('0.1.0');
    expect(content.createAttempt(17, { kind: 'live' }).snapshot().phase).toEqual({
      kind: 'pre-departure',
    });
  });

  it('keeps the shipped JSON baseline synchronized with the in-code fixtures', () => {
    expect(json('vsm-baseline-01/level.json')).toEqual(BASELINE_LEVEL_DEFINITION);
    expect(json('vsm-baseline-01/scenario.json')).toEqual(BASELINE_SCENARIO_DEFINITION);
    expect(json('vsm-baseline-01/actions.json')).toEqual(BASELINE_ACTION_CONTENT);
    expect(json('vsm-baseline-01/assessment.json')).toEqual(BASELINE_ASSESSMENT_CONFIG);
  });

  it('rejects manifest paths that escape the configured content root', () => {
    const temporary = mkdtempSync(join(tmpdir(), 'vsm-content-'));
    try {
      cpSync(contentDirectory, temporary, { recursive: true });
      const manifestPath = join(temporary, 'manifest.json');
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        bundles: Array<{ level: string }>;
      };
      const bundle = manifest.bundles[0];
      if (bundle === undefined) throw new Error('Expected baseline bundle');
      bundle.level = '../level.json';
      writeFileSync(manifestPath, JSON.stringify(manifest));

      expect(() => new FileGameContentRegistry(temporary)).toThrow(/escapes content directory/);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });

  it('fails fast when assessment configuration is invalid', () => {
    const temporary = mkdtempSync(join(tmpdir(), 'vsm-content-'));
    try {
      cpSync(contentDirectory, temporary, { recursive: true });
      const assessmentPath = join(temporary, 'vsm-baseline-01', 'assessment.json');
      const assessment = JSON.parse(readFileSync(assessmentPath, 'utf8')) as {
        startingScore: unknown;
      };
      assessment.startingScore = 'invalid';
      writeFileSync(assessmentPath, JSON.stringify(assessment));

      expect(() => new FileGameContentRegistry(temporary)).toThrow();
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });
});
