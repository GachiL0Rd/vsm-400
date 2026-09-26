import { describe, expect, it } from 'vitest';
import { doorScenario } from '../../test/fixtures/graphs';
import { routeName } from '../../test/fixtures/route-name';
import { createRng, createState, step, summarize, validateScenario, view } from './index';

describe('engine index', () => {
  it('собирает публичный прогон через баррель', () => {
    const door = doorScenario();
    expect(validateScenario(door).ok).toBe(true);
    const plan = {
      train: 'ВСМ 701',
      route: routeName('Москва', 'Санкт-Петербург'),
      fromStation: 'Москва',
      toStation: 'Санкт-Петербург',
      stops: ['Тверь', 'Бологое'],
      car: 1,
      carClass: 'ECONOMY' as const,
      scenarios: [
        { scenarioId: door.id, version: 1, params: { gameTimeMin: 540, nodeStepMin: 10 } },
      ],
    };
    const state = createState(plan, [door]);
    expect(view(state, door).choices.length).toBeGreaterThan(0);
    const done = step(
      state,
      door,
      { choiceId: 'inspect' },
      { elapsedMs: 500, plan, scenarios: [door] },
    );
    expect(summarize(done.state, [door]).facts.prevented).toBe(1);
    expect(createRng(Buffer.alloc(32, 1)).int(1, 1)).toBe(1);
  });
});
