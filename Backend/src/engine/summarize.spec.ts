import { describe, expect, it } from 'vitest';
import { climateScenario, doorScenario } from '../../test/fixtures/graphs';
import { routeName } from '../../test/fixtures/route-name';
import type { ScenarioGraph } from './schema';
import { createState, type StepContext, step } from './step';
import { summarize } from './summarize';
import type { ShiftPlan } from './types';

function planOf(entries: { id: string; params: Record<string, number> }[]): ShiftPlan {
  return {
    train: 'ВСМ 712',
    route: routeName('Москва', 'Санкт-Петербург'),
    fromStation: 'Москва',
    toStation: 'Санкт-Петербург',
    stops: ['Тверь', 'Бологое'],
    car: 3,
    carClass: 'FAMILY',
    departure: '06:20',
    scenarios: entries.map((entry) => ({
      scenarioId: entry.id,
      version: 1,
      params: entry.params,
    })),
  };
}

function play(
  state: ReturnType<typeof createState>,
  scenario: ScenarioGraph,
  choiceId: string,
  ctx: StepContext,
) {
  return step(state, scenario, { choiceId }, ctx).state;
}

describe('summarize', () => {
  it('собирает фиксированный прогон целиком', () => {
    const door = doorScenario();
    const climate = climateScenario();
    const plan = planOf([
      { id: door.id, params: { gameTimeMin: 540, nodeStepMin: 10 } },
      { id: climate.id, params: { gameTimeMin: 600, nodeStepMin: 10 } },
    ]);
    const scenarios = [door, climate];
    const base = { plan, scenarios };
    let state = createState(plan, scenarios);
    state = play(state, door, 'inspect', { ...base, elapsedMs: 800 });
    state = play(state, door, 'close', { ...base, elapsedMs: 2000 });
    state = play(state, climate, 'reset', { ...base, elapsedMs: 1500 });
    const summary = summarize(state, scenarios);
    expect(summary).toEqual({
      outcome: 'incident',
      loyalty: 58,
      safety: 65,
      politeness: 62,
      timeouts: 0,
      reactionAvgMs: 1433,
      competencyDelta: { procedure: 3, detection: 1, service: 2 },
      facts: { prevented: 2, incidents: 1, complaints: 1, interventions: 1 },
      decisions: [
        {
          idx: 0,
          gameTime: '09:00',
          stage: 'boarding',
          scenarioId: 'safe-door',
          nodeId: 'n1',
          choiceId: 'inspect',
          situation: 'Тамбурная дверь не встала на фиксатор',
          action: 'Проверить фиксатор и доложить',
          verdict: 'best',
          loyaltyDelta: 0,
          safetyDelta: 10,
          reactionMs: 800,
          timerSec: 20,
          consequence: null,
          lucky: false,
          better: null,
          basis: 'Регламент двери',
          deviation: false,
        },
        {
          idx: 1,
          gameTime: '09:10',
          stage: 'boarding',
          scenarioId: 'safe-door',
          nodeId: 'n2',
          choiceId: 'close',
          situation: 'Пассажир стоит в проходе у двери',
          action: 'Попросить отойти и закрыть створку',
          verdict: 'ok',
          loyaltyDelta: 6,
          safetyDelta: 0,
          reactionMs: 2000,
          timerSec: null,
          consequence: null,
          lucky: false,
          better: 'Сначала предупредить пассажира',
          basis: null,
          deviation: true,
        },
        {
          idx: 2,
          gameTime: '10:00',
          stage: 'handover',
          scenarioId: 'tech-ac',
          nodeId: 'n1',
          choiceId: 'reset',
          situation: 'В салоне душно, датчик молчит',
          action: 'Перезапустить климат и сказать, сколько ждать',
          verdict: 'best',
          loyaltyDelta: 2,
          safetyDelta: 5,
          reactionMs: 1500,
          timerSec: 15,
          consequence: null,
          lucky: true,
          better: null,
          basis: null,
          deviation: false,
        },
      ],
    });
    const leaked = summary.decisions[0];
    if (!leaked) {
      throw new Error('decision');
    }
    leaked.action = 'порча';
    expect(state.journal[0]?.action).toBe('Проверить фиксатор и доложить');
  });

  it('deviation не меняет вежливость, timeout и worse в долю не входят', () => {
    const polite = greet(false);
    const drifted = greet(true);
    const politeRun = finish(polite, 'help', 100);
    const driftedRun = finish(drifted, 'help', 100);
    expect(politeRun.decisions[0]?.deviation).toBe(false);
    expect(driftedRun.decisions[0]?.deviation).toBe(true);
    expect(driftedRun.politeness).toBe(politeRun.politeness);
    expect(driftedRun.politeness).toBe(75);
    expect(driftedRun.loyalty).toBe(50);

    const rude = greet(false);
    const node = rude.nodes.n1;
    if (!node || !('choices' in node)) {
      throw new Error('node');
    }
    const rudeChoice = node.choices[0];
    if (!rudeChoice) {
      throw new Error('choice');
    }
    rudeChoice.verdict = 'worse';
    const rudeRun = finish(rude, 'help', 100);
    expect(rudeRun.politeness).toBe(25);
    expect(rudeRun.loyalty).toBe(50);

    const slow = greet(false);
    const slowNode = slow.nodes.n1;
    if (!slowNode || !('choices' in slowNode)) {
      throw new Error('node');
    }
    slowNode.timer = 8;
    slowNode.onTimeout = {
      effects: { loyalty: -10 },
      verdict: 'missed',
      next: 'end',
    };
    const plan = onePlan(slow.id);
    const timed = step(createState(plan, [slow]), slow, 'timeout', {
      elapsedMs: 8000,
      plan,
      scenarios: [slow],
    }).state;
    const summary = summarize(timed, [slow]);
    expect(summary.timeouts).toBe(1);
    expect(summary.reactionAvgMs).toBe(0);
    expect(summary.politeness).toBe(15);
    expect(summary.decisions[0]?.action).toBe('Нет решения — время вышло');
  });

  it('gate не считает непройденный incident-финал', () => {
    const door = doorScenario();
    const plan = onePlan(door.id);
    const state = step(
      createState(plan, [door]),
      door,
      { choiceId: 'ignore' },
      {
        elapsedMs: 300,
        plan,
        scenarios: [door],
      },
    ).state;
    const summary = summarize(state, [door]);
    expect(summary.outcome).toBe('terminated');
    expect(summary.facts.incidents).toBe(0);
    expect(summary.facts.prevented).toBe(0);
  });

  it('флаг complaint на финале считается, если ход туда пришёл', () => {
    const marked = greet(false);
    const end = marked.nodes.end;
    if (!end || !('end' in end)) {
      throw new Error('end');
    }
    end.complaint = true;
    expect(finish(marked, 'help', 100).facts.complaints).toBe(1);

    const listed = greet(false);
    const listedEnd = listed.nodes.end;
    if (!listedEnd || !('end' in listedEnd)) {
      throw new Error('end');
    }
    listedEnd.set = ['complaint'];
    expect(finish(listed, 'help', 100).facts.complaints).toBe(1);
  });
});

function greet(deviation: boolean): ScenarioGraph {
  return {
    id: 'greet',
    title: 'Встреча',
    category: 'service',
    stage: 'boarding',
    carClasses: ['ECONOMY'],
    difficulty: 1,
    competencies: ['service'],
    init: { loyalty: 40, safety: 40 },
    start: 'n1',
    nodes: {
      n1: {
        text: 'Пассажир ищет место',
        choices: [
          {
            id: 'help',
            text: 'Проводить до кресла',
            effects: { loyalty: 10, safety: -2 },
            skills: { service: 1 },
            verdict: 'best',
            deviation,
            next: 'end',
          },
        ],
      },
      end: { end: 'completed', text: 'Сел' },
    },
  };
}

function onePlan(id: string): ShiftPlan {
  return planOf([{ id, params: { gameTimeMin: 480, nodeStepMin: 5 } }]);
}

function finish(scenario: ScenarioGraph, choiceId: string, elapsedMs: number) {
  const plan = onePlan(scenario.id);
  const state = step(
    createState(plan, [scenario]),
    scenario,
    { choiceId },
    {
      elapsedMs,
      plan,
      scenarios: [scenario],
    },
  ).state;
  return summarize(state, [scenario]);
}
