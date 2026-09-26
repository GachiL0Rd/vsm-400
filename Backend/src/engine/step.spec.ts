import { describe, expect, it } from 'vitest';
import { climateScenario, doorScenario } from '../../test/fixtures/graphs';
import { routeName } from '../../test/fixtures/route-name';
import { EngineError } from './errors';
import type { ScenarioGraph } from './schema';
import { createState, type StepContext, step } from './step';
import type { ShiftPlan } from './types';

function planOf(entries: { id: string; params?: Record<string, number> }[]): ShiftPlan {
  return {
    train: 'ВСМ 701',
    route: routeName('Москва', 'Санкт-Петербург'),
    fromStation: 'Москва',
    toStation: 'Санкт-Петербург',
    stops: ['Тверь', 'Бологое'],
    car: 1,
    carClass: 'ECONOMY',
    scenarios: entries.map((entry) => ({
      scenarioId: entry.id,
      version: 1,
      params: entry.params ?? { gameTimeMin: 9 * 60, nodeStepMin: 10 },
    })),
  };
}

function ctx(plan: ShiftPlan, scenarios: ScenarioGraph[], elapsedMs: number): StepContext {
  return { elapsedMs, plan, scenarios };
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return value;
}

describe('step', () => {
  it('createState берёт init первого сценария и не делит params с планом', () => {
    const door = doorScenario();
    const plan = planOf([{ id: door.id, params: { gameTimeMin: 540, nodeStepMin: 10 } }]);
    const state = createState(plan, [door]);
    expect(state).toMatchObject({
      scenarioIndex: 0,
      scenarioId: 'safe-door',
      nodeId: 'n1',
      loyalty: 50,
      safety: 50,
      seq: 0,
      outcome: null,
      flags: [],
      journal: [],
    });
    expect(state.params.scenarioTotal).toBe(1);
    const first = plan.scenarios[0];
    if (!first) {
      throw new Error('plan');
    }
    first.params.gameTimeMin = 1;
    expect(state.params.gameTimeMin).toBe(540);
    expect(() => createState(planOf([]), [])).toThrow(EngineError);
    expect(() => createState(planOf([{ id: 'nope' }]), [door])).toThrow(
      expect.objectContaining({ code: 'SCENARIO_MISSING' }),
    );
  });

  it('timeout идёт в onTimeout, не мутирует вход и повторяется', () => {
    const door = doorScenario();
    const plan = planOf([{ id: door.id }]);
    const state = createState(plan, [door]);
    const before = structuredClone(state);
    deepFreeze(state);
    deepFreeze(door);
    const first = step(state, door, 'timeout', ctx(plan, [door], 9000));
    const second = step(state, door, 'timeout', ctx(plan, [door], 9000));
    expect(state).toEqual(before);
    expect(second).toEqual(first);
    expect(first.state.nodeId).toBe('n2');
    expect(first.state.timeouts).toBe(1);
    expect(first.state.safety).toBe(45);
    expect(first.state.loyalty).toBe(45);
    expect(first.state.flags).toEqual(['hesitated']);
    expect(first.entry).toMatchObject({
      choiceId: 'timeout',
      action: 'Нет решения — время вышло',
      verdict: 'missed',
      consequence: 'Дверь осталась без контроля',
      reactionMs: null,
      safetyDelta: -5,
      loyaltyDelta: -5,
      gameTime: '09:00',
    });
  });

  it('неизвестный выбор, requires и ход после финала — ошибки без записи', () => {
    const door = doorScenario();
    const scenario: ScenarioGraph = {
      ...door,
      nodes: {
        ...door.nodes,
        n1: {
          text: 'Старт',
          choices: [
            { id: 'open', text: 'Открыть', set: ['approached'], verdict: 'ok', next: 'n2' },
            {
              id: 'late',
              text: 'Потом',
              requires: { flags: ['approached', 'ticket'] },
              next: 'end-ok',
            },
          ],
        },
      },
    };
    const plan = planOf([{ id: scenario.id }]);
    const state = createState(plan, [scenario]);
    expect(() => step(state, scenario, { choiceId: 'nope' }, ctx(plan, [scenario], 10))).toThrow(
      expect.objectContaining({ code: 'UNKNOWN_CHOICE' }),
    );
    expect(() => step(state, scenario, { choiceId: 'late' }, ctx(plan, [scenario], 10))).toThrow(
      expect.objectContaining({ code: 'CHOICE_NOT_AVAILABLE' }),
    );
    expect(state.journal).toHaveLength(0);
    const opened = step(state, scenario, { choiceId: 'open' }, ctx(plan, [scenario], 10));
    expect(opened.state.flags).toEqual(['approached']);
    const done = step(opened.state, scenario, { choiceId: 'close' }, ctx(plan, [scenario], 10));
    expect(done.state.outcome).toBe('completed');
    expect(() =>
      step(done.state, scenario, { choiceId: 'close' }, ctx(plan, [scenario], 10)),
    ).toThrow(expect.objectContaining({ code: 'SESSION_FINISHED' }));
  });

  it('clamp режет шкалы, в журнал пишет сырую дельту', () => {
    const door = doorScenario();
    const scenario: ScenarioGraph = {
      ...door,
      nodes: {
        ...door.nodes,
        n1: {
          text: 'Край',
          choices: [
            {
              id: 'spike',
              text: 'Скачок',
              effects: { loyalty: 80, safety: -100 },
              verdict: 'worse',
              next: 'end-ok',
            },
          ],
        },
      },
    };
    const plan = planOf([{ id: scenario.id }]);
    const state = createState(plan, [scenario]);
    const result = step(state, scenario, { choiceId: 'spike' }, ctx(plan, [scenario], 100));
    expect(result.state.loyalty).toBe(100);
    expect(result.state.safety).toBe(0);
    expect(result.entry.loyaltyDelta).toBe(80);
    expect(result.entry.safetyDelta).toBe(-100);
  });

  it('effectsIf зависит от params и складывается с базовым эффектом', () => {
    const door = doorScenario();
    const choice = {
      id: 'vent',
      text: 'Открыть клапан',
      effects: { safety: 10 },
      verdict: 'ok' as const,
      next: 'end-ok',
    };
    Object.assign(choice, {
      effectsIf: [
        { if: { param: 'occupancy', gte: 80 }, effects: { safety: -4 }, skills: { reaction: 2 } },
        { if: { param: 'occupancy', lt: 10 }, effects: { safety: 1 } },
      ],
    });
    const scenario: ScenarioGraph = {
      ...door,
      gates: undefined,
      nodes: { ...door.nodes, n1: { text: 'Духота', choices: [choice] } },
    };
    const crowded = planOf([
      { id: scenario.id, params: { occupancy: 90, gameTimeMin: 540, nodeStepMin: 10 } },
    ]);
    const hit = step(
      createState(crowded, [scenario]),
      scenario,
      { choiceId: 'vent' },
      ctx(crowded, [scenario], 50),
    );
    expect(hit.state.safety).toBe(56);
    expect(hit.entry.safetyDelta).toBe(6);
    expect(hit.state.skills.reaction).toBe(2);
    const empty = planOf([
      { id: scenario.id, params: { occupancy: 50, gameTimeMin: 540, nodeStepMin: 10 } },
    ]);
    const miss = step(
      createState(empty, [scenario]),
      scenario,
      { choiceId: 'vent' },
      ctx(empty, [scenario], 50),
    );
    expect(miss.state.safety).toBe(60);
    expect(miss.state.skills.reaction).toBeUndefined();
  });

  it('gates safety ниже порога обрывают смену, не заходя в next', () => {
    const door = doorScenario();
    const climate = climateScenario();
    const plan = planOf([
      { id: door.id, params: { gameTimeMin: 540, nodeStepMin: 10 } },
      { id: climate.id, params: { gameTimeMin: 600, nodeStepMin: 10 } },
    ]);
    const scenarios = [door, climate];
    const result = step(
      createState(plan, scenarios),
      door,
      { choiceId: 'ignore' },
      ctx(plan, scenarios, 400),
    );
    expect(result.state.outcome).toBe('terminated');
    expect(result.state.nodeId).toBe('n1');
    expect(result.state.scenarioIndex).toBe(0);
    expect(result.state.safety).toBe(10);
    expect(result.state.loyalty).toBe(40);
    expect(() =>
      step(result.state, door, { choiceId: 'inspect' }, ctx(plan, scenarios, 10)),
    ).toThrow(expect.objectContaining({ code: 'SESSION_FINISHED' }));
  });

  it('после финала переходит к следующему сценарию и не сбрасывает шкалы', () => {
    const door = doorScenario();
    const climate = climateScenario();
    const plan = planOf([
      { id: door.id, params: { gameTimeMin: 540, nodeStepMin: 10 } },
      { id: climate.id, params: { gameTimeMin: 600, nodeStepMin: 10 } },
    ]);
    const scenarios = [door, climate];
    let state = createState(plan, scenarios);
    state = step(state, door, { choiceId: 'inspect' }, ctx(plan, scenarios, 800)).state;
    expect(state.journal[0]?.gameTime).toBe('09:00');
    const mid = step(state, door, { choiceId: 'close' }, ctx(plan, scenarios, 2000));
    expect(mid.state.outcome).toBeNull();
    expect(mid.state.scenarioId).toBe('tech-ac');
    expect(mid.state.nodeId).toBe('n1');
    expect(mid.state.scenarioIndex).toBe(1);
    expect(mid.state.loyalty).toBe(56);
    expect(mid.state.safety).toBe(60);
    expect(mid.state.flags).toEqual(['intervention']);
    expect(mid.state.seq).toBe(2);
    expect(mid.entry.gameTime).toBe('09:10');
    const done = step(mid.state, climate, { choiceId: 'reset' }, ctx(plan, scenarios, 1500));
    expect(done.state.outcome).toBe('incident');
    expect(done.state.nodeId).toBe('end-inc');
    expect(done.state.loyalty).toBe(58);
    expect(done.state.safety).toBe(65);
    expect(done.entry.lucky).toBe(true);
    expect(done.entry.gameTime).toBe('10:00');
    expect(done.entry.deviation).toBe(false);
  });

  it('явный terminated не пускает в следующий сценарий', () => {
    const door = doorScenario();
    const climate = climateScenario();
    const scenario: ScenarioGraph = {
      ...door,
      nodes: {
        ...door.nodes,
        n1: {
          text: 'Стоп',
          choices: [{ id: 'stop', text: 'Остановить', verdict: 'worse', next: 'end-stop' }],
        },
        'end-stop': { end: 'terminated', text: 'Смена снята' },
      },
    };
    const plan = planOf([{ id: scenario.id }, { id: climate.id }]);
    const result = step(
      createState(plan, [scenario, climate]),
      scenario,
      { choiceId: 'stop' },
      ctx(plan, [scenario, climate], 10),
    );
    expect(result.state.outcome).toBe('terminated');
    expect(result.state.scenarioIndex).toBe(0);
    expect(result.state.nodeId).toBe('end-stop');
  });

  it('incident прошлого перегона оставляет итог incident', () => {
    const incident = ended('bad', 'incident');
    const done = ended('good', 'completed');
    const plan = planOf([{ id: incident.id }, { id: done.id }]);
    const scenarios = [incident, done];
    const mid = step(
      createState(plan, scenarios),
      incident,
      { choiceId: 'go' },
      ctx(plan, scenarios, 10),
    );
    expect(mid.state.outcome).toBeNull();
    const last = step(mid.state, done, { choiceId: 'go' }, ctx(plan, scenarios, 10));
    expect(last.state.outcome).toBe('incident');
  });

  it('узел без onTimeout не принимает timeout', () => {
    const door = doorScenario();
    const plan = planOf([{ id: door.id }]);
    const state = step(
      createState(plan, [door]),
      door,
      { choiceId: 'inspect' },
      ctx(plan, [door], 10),
    ).state;
    expect(() => step(state, door, 'timeout', ctx(plan, [door], 10))).toThrow(
      expect.objectContaining({ code: 'TIMEOUT_UNHANDLED' }),
    );
  });
});

function ended(id: string, outcome: 'incident' | 'completed'): ScenarioGraph {
  return {
    id,
    title: id,
    category: 'service',
    stage: 'enroute',
    carClasses: ['ECONOMY'],
    difficulty: 1,
    competencies: ['service'],
    init: { loyalty: 40, safety: 40 },
    start: 'n1',
    nodes: {
      n1: {
        text: id,
        choices: [
          { id: 'go', text: 'Дальше', verdict: 'ok', effects: { loyalty: 1 }, next: 'end' },
        ],
      },
      end: { end: outcome, text: 'финиш' },
    },
  };
}
