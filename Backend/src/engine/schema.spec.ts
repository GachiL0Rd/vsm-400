import { describe, expect, it } from 'vitest';
import { isEndNode, type ScenarioGraph, ScenarioGraphSchema } from './schema';

const validGraph = {
  id: 'med-chest-pain',
  title: 'Пассажиру плохо на 300 км/ч',
  category: 'medical',
  stage: 'enroute',
  carClasses: ['BUSINESS', 'FIRST'],
  difficulty: 2,
  competencies: ['reaction', 'escalation', 'safety'],
  params: {
    nextStopMin: { min: 6, max: 25 },
    occupancy: { min: 40, max: 100 },
  },
  init: { loyalty: 60, safety: 60 },
  gates: { failIf: { safety: { lt: 30 } } },
  start: 'n1',
  nodes: {
    n1: {
      text: 'Пассажир побледнел, держится за грудь',
      variants: [{ if: { param: 'nextStopMin', lt: 10 }, text: 'До станции меньше 10 минут' }],
      timer: 15,
      choices: [
        {
          id: 'ask',
          text: 'Подойти, спросить о самочувствии',
          effects: { safety: 10, loyalty: 5 },
          skills: { reaction: 2, service: 1 },
          set: ['approached'],
          verdict: 'best',
          next: 'end-ok',
        },
        {
          id: 'pill',
          text: 'Дать таблетку, которую просит пассажир',
          effects: { safety: -20, loyalty: 8 },
          verdict: 'worse',
          better: 'Лекарства проводник не назначает: вызвать медика через начальника поезда',
          basis: 'Ситуации на борту',
          next: 'end-bad',
        },
        {
          id: 'call-doctor',
          text: 'Вызвать медика через начальника поезда',
          requires: { flags: ['approached'] },
          deviation: true,
          next: 'end-ok',
        },
      ],
      onTimeout: {
        effects: { safety: -15, loyalty: -10 },
        set: ['hesitated'],
        verdict: 'missed',
        consequence: 'Пассажир сполз с кресла',
        next: 'end-bad',
      },
    },
    'end-ok': { end: 'completed', text: 'Медик принял пассажира' },
    'end-bad': { end: 'incident', text: 'Ситуация вышла из-под контроля' },
  },
};

describe('ScenarioGraphSchema', () => {
  it('принимает граф из SPEC §5', () => {
    const parsed = ScenarioGraphSchema.safeParse(validGraph);
    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      return;
    }
    const graph: ScenarioGraph = parsed.data;
    expect(graph.id).toBe('med-chest-pain');
    const end = graph.nodes['end-ok'];
    expect(end).toBeDefined();
    if (!end) {
      return;
    }
    expect(isEndNode(end)).toBe(true);
    const start = graph.nodes.n1;
    expect(start).toBeDefined();
    if (!start || isEndNode(start)) {
      return;
    }
    expect(start.choices.map((choice) => choice.id)).toEqual(['ask', 'pill', 'call-doctor']);
  });

  it('принимает effectsIf, lucky, consequence и complaint на финале', () => {
    const start = validGraph.nodes.n1;
    if (!('choices' in start)) {
      throw new Error('n1');
    }
    const ask = start.choices[0];
    if (!ask) {
      throw new Error('ask');
    }
    const parsed = ScenarioGraphSchema.safeParse({
      ...validGraph,
      nodes: {
        ...validGraph.nodes,
        n1: {
          ...start,
          choices: [
            {
              ...ask,
              consequence: 'Пассажир сел ровнее',
              lucky: true,
              effectsIf: [{ if: { param: 'nextStopMin', lt: 10 }, effects: { safety: 1 } }],
            },
            ...start.choices.slice(1),
          ],
        },
        'end-bad': {
          end: 'incident',
          text: 'Ситуация вышла из-под контроля',
          complaint: true,
          set: ['intervention'],
        },
      },
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      return;
    }
    const node = parsed.data.nodes.n1;
    if (!node || isEndNode(node)) {
      throw new Error('n1');
    }
    expect(node.choices[0]?.lucky).toBe(true);
    expect(node.choices[0]?.consequence).toBe('Пассажир сел ровнее');
    expect(node.choices[0]?.effectsIf).toHaveLength(1);
    const finale = parsed.data.nodes['end-bad'];
    if (!finale || !isEndNode(finale)) {
      throw new Error('end');
    }
    expect(finale.complaint).toBe(true);
    expect(finale.set).toEqual(['intervention']);
  });

  it('отклоняет чужую категорию и сломанный узел', () => {
    const badCategory = ScenarioGraphSchema.safeParse({ ...validGraph, category: 'magic' });
    expect(badCategory.success).toBe(false);

    const badDifficulty = ScenarioGraphSchema.safeParse({ ...validGraph, difficulty: 9 });
    expect(badDifficulty.success).toBe(false);

    const badNode = ScenarioGraphSchema.safeParse({
      ...validGraph,
      nodes: { ...validGraph.nodes, n1: { text: 'без выборов' } },
    });
    expect(badNode.success).toBe(false);
  });
});
