import { UnprocessableEntityException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { ScenarioGraph } from '../engine/schema';
import { assertPlayableGraph } from './graph-check';

const broken = {
  id: 'broken',
  title: 'Дыра',
  category: 'safety',
  stage: 'enroute',
  carClasses: ['ECONOMY'],
  difficulty: 1,
  competencies: ['safety'],
  params: {},
  init: { loyalty: 60, safety: 60 },
  gates: {},
  start: 'n1',
  nodes: {
    n1: {
      text: 'Текст',
      choices: [{ id: 'go', text: 'Дальше', next: 'missing' }],
    },
  },
} as unknown as ScenarioGraph;

describe('assertPlayableGraph', () => {
  it('отклоняет next в никуда', () => {
    expect(() => assertPlayableGraph(broken)).toThrow(UnprocessableEntityException);
  });
});
