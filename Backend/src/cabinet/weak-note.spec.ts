import { describe, expect, it } from 'vitest';
import { blankScores } from './competencies';
import type { TaggedDecision } from './decision-tags';
import { buildWeakNotes, FAST_TREND } from './weak-note';

const runs = ['r0', 'r1', 'r2', 'r3', 'r4'];

function decision(
  runId: string,
  verdict: TaggedDecision['verdict'],
  competencies: TaggedDecision['competencies'],
  stage: TaggedDecision['stage'] = 'enroute',
): TaggedDecision {
  return {
    runId,
    stage,
    verdict,
    competencies,
    reactionMs: null,
    lucky: false,
  };
}

function notes(overrides: {
  scores?: Partial<ReturnType<typeof blankScores>>;
  trend?: Partial<ReturnType<typeof blankScores>>;
  decisions?: TaggedDecision[];
  runIds?: string[];
}) {
  return buildWeakNotes({
    scores: { ...blankScores(80), escalation: 43, ...overrides.scores },
    trend: { ...blankScores(0), ...overrides.trend },
    weakScore: 50,
    runIds: overrides.runIds ?? runs,
    decisions: overrides.decisions ?? [],
  });
}

describe('weakNote', () => {
  it('эскалация ниже порога: давление критическое или стоп-кран не при опасности', () => {
    const decisions = [
      decision('r0', 'worse', ['escalation']),
      decision('r1', 'ok', ['escalation']),
      decision('r2', 'missed', ['escalation']),
      decision('r3', 'best', ['escalation']),
      decision('r4', 'best', ['escalation']),
      decision('old', 'worse', ['escalation']),
    ];
    expect(notes({ decisions }).escalation).toBe(
      'В 3 из 5 последних рейсов давление стало критическим или стоп-кран применён не при опасности.',
    );
  });

  it('быстрый рост обнаружения считает best на приёмке', () => {
    const decisions = [
      decision('r0', 'best', ['detection'], 'acceptance'),
      decision('r1', 'best', ['detection'], 'acceptance'),
      decision('r2', 'missed', ['detection'], 'acceptance'),
    ];
    const result = notes({
      scores: { detection: 70 },
      trend: { detection: FAST_TREND },
      decisions,
    });
    expect(result.detection).toBe(
      'Растёт: 2 журнала приёмки сданы без пропуска и без ложной отметки.',
    );
    expect(result.safety).toBeUndefined();
  });

  it('просадка важнее роста: у слабой компетенции текст ошибки', () => {
    const decisions = [decision('r0', 'missed', ['detection'], 'acceptance')];
    const result = notes({
      scores: { detection: 40 },
      trend: { detection: 9 },
      decisions,
    });
    expect(result.detection).toBe(
      'В 1 из 5 последних рейсов журнал приёмки сдан с пропуском неисправности или с ложной отметкой.',
    );
  });

  it('без рейсов не делит на ноль', () => {
    expect(notes({ runIds: [], scores: { safety: 10 } }).safety).toBe(
      'Безопасность ниже порога 50: посадки, пожара, давления и стоп-крана в рейсах ещё нет.',
    );
  });

  it('чужая компетенция выбора не попадает в заметку эскалации', () => {
    const decisions = [decision('r0', 'worse', ['service'])];
    const result = notes({ scores: { escalation: 40, service: 40 }, decisions });
    expect(result.escalation).toBe(
      'Давление и стоп-кран в последних рейсах без ошибки, но эскалация всё ещё ниже порога.',
    );
    expect(result.service).toContain('запрос пассажира остался без ответа');
  });
});
