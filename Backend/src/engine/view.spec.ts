import { describe, expect, it } from 'vitest';
import { doorScenario } from '../../test/fixtures/graphs';
import { routeName } from '../../test/fixtures/route-name';
import type { ScenarioGraph } from './schema';
import { createState, step } from './step';
import type { ShiftPlan } from './types';
import { view } from './view';

function plan(ids: string[]): ShiftPlan {
  return {
    train: 'ВСМ 701',
    route: routeName('Москва', 'Санкт-Петербург'),
    fromStation: 'Москва',
    toStation: 'Санкт-Петербург',
    stops: ['Тверь'],
    car: 2,
    carClass: 'ECONOMY',
    departure: '06:20',
    scenarios: ids.map((id) => ({
      scenarioId: id,
      version: 1,
      params: { gameTimeMin: 400, nodeStepMin: 5 },
    })),
  };
}

describe('view', () => {
  it('отдаёт текст, шкалы и выборы без эффектов и вердикта', () => {
    const door = doorScenario();
    const state = createState(plan([door.id, 'next']), [door]);
    const shown = view(state, door);
    expect(shown.choices).toEqual([
      { id: 'inspect', text: 'Проверить фиксатор и доложить' },
      { id: 'ignore', text: 'Оставить и идти по салону' },
    ]);
    expect(Object.keys(shown.choices[0] ?? {})).toEqual(['id', 'text']);
    expect(JSON.stringify(shown.choices)).not.toContain('verdict');
    expect(JSON.stringify(shown.choices)).not.toContain('effects');
    expect(JSON.stringify(shown.choices)).not.toContain('better');
    expect(shown).toMatchObject({
      nodeId: 'n1',
      text: 'Тамбурная дверь не встала на фиксатор',
      timerSec: 20,
      loyalty: 50,
      safety: 50,
      seq: 0,
      finished: false,
      progress: { index: 1, total: 2 },
    });
  });

  it('подменяет текст первым совпавшим variant по param и флагу', () => {
    const graph = {
      id: 'quiet',
      title: 'Тишина',
      category: 'service',
      stage: 'enroute',
      carClasses: ['FIRST'],
      difficulty: 1,
      competencies: ['service'],
      init: { loyalty: 70, safety: 70 },
      start: 'n1',
      nodes: {
        n1: {
          text: 'Базовый текст',
          variants: [
            { if: { flag: 'quiet', param: 'nextStopMin', lt: 10 }, text: 'Оба условия' },
            { if: { param: 'nextStopMin', lt: 10 }, text: 'До станции меньше 10 минут' },
            { if: { flag: 'quiet' }, text: 'Тихий салон' },
          ],
          choices: [{ id: 'ok', text: 'Кивнуть', next: 'end' }],
        },
        end: { end: 'completed', text: 'конец' },
      },
    } as ScenarioGraph;
    const shift = plan([graph.id]);
    const state = createState(shift, [graph]);
    state.params.nextStopMin = 8;
    expect(view(state, graph).text).toBe('До станции меньше 10 минут');
    state.flags.push('quiet');
    expect(view(state, graph).text).toBe('Оба условия');
    state.params.nextStopMin = 20;
    expect(view(state, graph).text).toBe('Тихий салон');
    state.flags.length = 0;
    expect(view(state, graph).text).toBe('Базовый текст');
  });

  it('прячет выбор с невыполненным requires и ужимает таймер по now', () => {
    const door = doorScenario();
    const graph: ScenarioGraph = {
      ...door,
      nodes: {
        ...door.nodes,
        n1: {
          text: 'Билет',
          timer: 15,
          choices: [
            { id: 'ask', text: 'Спросить', set: ['asked'], next: 'end-ok' },
            { id: 'fine', text: 'Оформить', requires: { flags: ['asked'] }, next: 'end-ok' },
          ],
        },
      },
    };
    const state = createState(plan([graph.id]), [graph]);
    expect(view(state, graph).choices.map((choice) => choice.id)).toEqual(['ask']);
    expect(view(state, graph, 4500).timerSec).toBe(11);
    expect(view(state, graph, 0).timerSec).toBe(15);
    expect(view(state, graph, 20_000).timerSec).toBe(0);
  });

  it('на финале и после gates не показывает выборы', () => {
    const door = doorScenario();
    const shift = plan([door.id]);
    const done = step(
      createState(shift, [door]),
      door,
      { choiceId: 'inspect' },
      {
        elapsedMs: 10,
        plan: shift,
        scenarios: [door],
      },
    ).state;
    const mid = view(done, door);
    expect(mid.finished).toBe(false);
    expect(mid.nodeId).toBe('n2');
    expect(mid.timerSec).toBeNull();
    const ended = step(
      done,
      door,
      { choiceId: 'close' },
      {
        elapsedMs: 10,
        plan: shift,
        scenarios: [door],
      },
    ).state;
    const finale = view(ended, door);
    expect(finale.finished).toBe(true);
    expect(finale.text).toBe('Дверь зафиксирована');
    expect(finale.choices).toEqual([]);
    expect(finale.timerSec).toBeNull();
  });
});
