import type { ScenarioGraph } from '../../src/engine/schema';

export function doorScenario(): ScenarioGraph {
  return {
    id: 'safe-door',
    title: 'Дверь тамбура',
    category: 'safety',
    stage: 'boarding',
    carClasses: ['ECONOMY'],
    difficulty: 2,
    competencies: ['safety'],
    init: { loyalty: 50, safety: 50 },
    gates: { failIf: { safety: { lt: 20 } } },
    start: 'n1',
    nodes: {
      n1: {
        text: 'Тамбурная дверь не встала на фиксатор',
        timer: 20,
        choices: [
          {
            id: 'inspect',
            text: 'Проверить фиксатор и доложить',
            effects: { safety: 10 },
            skills: { detection: 1 },
            verdict: 'best',
            basis: 'Регламент двери',
            next: 'n2',
          },
          {
            id: 'ignore',
            text: 'Оставить и идти по салону',
            effects: { safety: -40, loyalty: -10 },
            verdict: 'worse',
            next: 'end-bad',
          },
        ],
        onTimeout: {
          effects: { safety: -5, loyalty: -5 },
          set: ['hesitated'],
          verdict: 'missed',
          consequence: 'Дверь осталась без контроля',
          next: 'n2',
        },
      },
      n2: {
        text: 'Пассажир стоит в проходе у двери',
        choices: [
          {
            id: 'close',
            text: 'Попросить отойти и закрыть створку',
            effects: { loyalty: 6 },
            skills: { service: 2 },
            set: ['intervention'],
            verdict: 'ok',
            deviation: true,
            better: 'Сначала предупредить пассажира',
            next: 'end-ok',
          },
        ],
      },
      'end-ok': { end: 'completed', text: 'Дверь зафиксирована' },
      'end-bad': { end: 'incident', text: 'Дверь ушла из-под контроля' },
    },
  };
}

export function climateScenario(): ScenarioGraph {
  const reset = {
    id: 'reset',
    text: 'Перезапустить климат и сказать, сколько ждать',
    effects: { safety: 5, loyalty: 2 },
    skills: { procedure: 3 },
    set: ['complaint'],
    verdict: 'best' as const,
    next: 'end-inc',
  };
  Object.assign(reset, { lucky: true });
  return {
    id: 'tech-ac',
    title: 'Климат в вагоне',
    category: 'technical',
    stage: 'handover',
    carClasses: ['ECONOMY'],
    difficulty: 1,
    competencies: ['procedure'],
    init: { loyalty: 1, safety: 1 },
    start: 'n1',
    nodes: {
      n1: {
        text: 'В салоне душно, датчик молчит',
        timer: 15,
        choices: [reset],
        onTimeout: {
          effects: { safety: -5 },
          verdict: 'missed',
          next: 'end-inc',
        },
      },
      'end-inc': { end: 'incident', text: 'Климат так и не вышел на режим' },
    },
  };
}
