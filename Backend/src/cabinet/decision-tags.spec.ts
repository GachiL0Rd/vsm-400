import { describe, expect, it } from 'vitest';
import { decisionCompetencies } from './decision-tags';

const graph = {
  nodes: {
    n1: {
      choices: [
        { id: 'report', skills: { escalation: 2 } },
        { id: 'inspect', skills: { detection: 1, safety: 1 } },
      ],
    },
  },
};

describe('decisionCompetencies', () => {
  it('берёт skills выбора, а не весь сценарий', () => {
    expect(decisionCompetencies(['escalation', 'detection'], graph, 'n1', 'report')).toEqual([
      'escalation',
    ]);
  });

  it('timeout остаётся на компетенциях сценария', () => {
    expect(decisionCompetencies(['escalation'], graph, 'n1', 'timeout')).toEqual(['escalation']);
  });

  it('без графа хватает сценария', () => {
    expect(decisionCompetencies(['service'], null, 'n1', 'report')).toEqual(['service']);
  });

  it('факт игры без сценария YAML берёт таблицу компетенций факта', () => {
    expect(decisionCompetencies([], null, 'fire:cabin-fire', 'fire')).toEqual([
      'safety',
      'reaction',
    ]);
    expect(decisionCompetencies([], null, 'emergency-brake', 'emergency-brake')).toEqual([
      'safety',
      'escalation',
    ]);
  });
});
