import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BASELINE_HINT_CONTENT } from '../projection/hint-content.ts';
import { BASELINE_ASSESSMENT_CONFIG } from '../simulation/assessment-config.ts';
import { BASELINE_ACTION_CONTENT } from '../simulation/baseline-content.ts';
import { BASELINE_LEVEL_DEFINITION } from '../simulation/level.ts';
import { BASELINE_SCENARIO_DEFINITION } from '../simulation/scenario.ts';
import { parseServerConfig } from './config.ts';
import { FileGameContentRegistry } from './content-registry.ts';
import { MockPlatformGateway, mockMode } from './platform-gateway.ts';
import { InMemoryResumeTokenRegistry } from './resume-token-registry.ts';
import { GameSessionHost } from './session-host.ts';

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
    expect(json('vsm-baseline-01/hints.json')).toEqual(BASELINE_HINT_CONTENT);
    expect(json('vsm-train2-01/hints.json')).toEqual(BASELINE_HINT_CONTENT);
    expect(json('vsm-train2-01/actions.json')).toEqual(BASELINE_ACTION_CONTENT);
    expect(json('vsm-train2-01/assessment.json')).toEqual(BASELINE_ASSESSMENT_CONFIG);
  });

  it('loads both content bundles', () => {
    const registry = new FileGameContentRegistry(contentDirectory);
    expect(registry.resolve('vsm-baseline-01').gameLevelVersion).toBe('vsm-baseline-01');
    const train2 = registry.resolve('vsm-train2-01');
    expect(train2.gameLevelVersion).toBe('vsm-train2-01');
    expect(train2.simulationCompatibilityVersion).toBe('0.1.0');
    const attempt = train2.createAttempt(17, { kind: 'live' });
    expect(attempt.level.definition.id).toBe('vsm-train2-01');
    expect(attempt.entities.get('player').position).toEqual({
      kind: 'cell',
      cellId: 'platform-origin.x-3y8',
    });
  });

  it('resolves a mock session to the default train2 level', async () => {
    const config = parseServerConfig({});
    expect(config.mock.gameLevelId).toBe('vsm-train2-01');
    expect(config.mock.mode).toBe('guided');
    const host = new GameSessionHost({
      platformGateway: new MockPlatformGateway({
        attemptId: config.mock.attemptId,
        gameLevelId: config.mock.gameLevelId,
        mode: mockMode(config.mock.mode),
      }),
      contentRegistry: new FileGameContentRegistry(contentDirectory),
      resumeTokens: new InMemoryResumeTokenRegistry(),
      disconnectDebounceMs: 1_000,
      reconnectGraceMs: 30_000,
      simulationStepMs: 60_000,
    });
    await host.attachWithSessionKey('local-session', 'connection-1');
    const worker = host.worker(config.mock.attemptId);
    expect(worker?.projection.attempt.level.definition.id).toBe('vsm-train2-01');
    expect(worker?.projection.mode).toMatchObject({
      kind: 'guided',
      hints: {
        immediateFeedback: true,
        suggestions: true,
        objectHighlights: true,
        explanations: true,
      },
    });
    worker?.projection.advanceTo(0);
    const hints = worker?.projection
      .takePresentationEvents()
      .flatMap((message) =>
        message.type === 'presentation-event' && message.event.kind === 'hint'
          ? [message.event]
          : [],
      );
    expect(hints?.[0]).toMatchObject({
      kind: 'hint',
      hintId: 'attempt-start',
      presentation: 'message',
      target: { kind: 'object', objectId: 'acceptance-journal' },
    });
    host.shutdown();
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
