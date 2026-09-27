import { describe, expect, it } from 'vitest';
import { doorScenario } from '../../test/fixtures/graphs';
import { routeName } from '../../test/fixtures/route-name';
import {
  applyTextVariant,
  createRng,
  createState,
  isEndNode,
  orderChoices,
  step,
  summarize,
  type TextVariant,
  view,
} from './index';
import type { ShiftPlan } from './types';

const DOOR_TEXT = 'Тамбурная дверь не встала на фиксатор';
const INSPECT_TEXT = 'Проверить фиксатор и доложить';

function plan(id: string): ShiftPlan {
  return {
    train: 'ВСМ 701',
    route: routeName('Москва', 'Санкт-Петербург'),
    fromStation: 'Москва',
    toStation: 'Санкт-Петербург',
    stops: ['Тверь'],
    car: 2,
    carClass: 'ECONOMY',
    departure: '06:20',
    scenarios: [{ scenarioId: id, version: 1, params: { gameTimeMin: 400, nodeStepMin: 5 } }],
  };
}

function doorNode() {
  const node = doorScenario().nodes.n1;
  if (!node || isEndNode(node)) {
    throw new Error('тест: n1 не узел решения');
  }
  return node;
}

const shown: TextVariant = {
  text: 'Створка тамбура не села в фиксатор',
  choices: [
    { id: 'ignore', text: 'Пройти мимо в салон' },
    { id: 'inspect', text: 'Глянуть фиксатор и доложить начальнику' },
  ],
};

describe('applyTextVariant', () => {
  it('меняет тексты и оставляет effects, next и verdict', () => {
    const node = doorNode();
    const next = applyTextVariant(node, shown);
    expect(next).not.toBe(node);
    expect(next.text).toBe(shown.text);
    expect(next.choices.map((choice) => choice.id)).toEqual(['inspect', 'ignore']);
    expect(next.choices.map((choice) => choice.text)).toEqual([
      'Глянуть фиксатор и доложить начальнику',
      'Пройти мимо в салон',
    ]);
    expect(next.choices[0]).toMatchObject({
      effects: { safety: 10 },
      next: 'n2',
      verdict: 'best',
      basis: 'Регламент двери',
    });
    expect(next.choices[1]).toMatchObject({
      effects: { safety: -40, loyalty: -10 },
      next: 'end-bad',
      verdict: 'worse',
    });
    expect(next.onTimeout).toBe(node.onTimeout);
    expect(next.timer).toBe(node.timer);
    expect(node.text).toBe(DOOR_TEXT);
    expect(node.choices[0]?.text).toBe(INSPECT_TEXT);
  });

  it('игнорирует вариант с чужими id и пустой вариант', () => {
    const node = doorNode();
    const missing = applyTextVariant(node, {
      text: 'Чужой',
      choices: [{ id: 'inspect', text: 'Только один' }],
    });
    const extra = applyTextVariant(node, {
      text: 'Чужой',
      choices: [
        { id: 'inspect', text: 'А' },
        { id: 'ignore', text: 'Б' },
        { id: 'other', text: 'В' },
      ],
    });
    const swapped = applyTextVariant(node, {
      text: 'Чужой',
      choices: [
        { id: 'inspect', text: 'А' },
        { id: 'nope', text: 'Б' },
      ],
    });
    const duplicated = applyTextVariant(node, {
      text: 'Чужой',
      choices: [
        { id: 'inspect', text: 'А' },
        { id: 'inspect', text: 'Б' },
      ],
    });
    expect(missing).toBe(node);
    expect(extra).toBe(node);
    expect(swapped).toBe(node);
    expect(duplicated).toBe(node);
    expect(applyTextVariant(node, undefined)).toBe(node);
    expect(node.text).toBe(DOOR_TEXT);
  });

  it('на финале подменяет только текст и только без выборов', () => {
    const end = doorScenario().nodes['end-ok'];
    if (!end || !isEndNode(end)) {
      throw new Error('тест: end-ok');
    }
    const next = applyTextVariant(end, { text: 'Створка села в фиксатор', choices: [] });
    expect(next.text).toBe('Створка села в фиксатор');
    expect(next.end).toBe('completed');
    expect(end.text).toBe('Дверь зафиксирована');
    expect(applyTextVariant(end, shown)).toBe(end);
  });
});

describe('orderChoices', () => {
  const labels = ['a', 'b', 'c', 'd', 'e'];

  it('один seed даёт один порядок, другой seed — другой', () => {
    const seedA = Buffer.alloc(32, 1);
    const seedB = Buffer.alloc(32, 2);
    const first = orderChoices(labels, createRng(seedA));
    const again = orderChoices(labels, createRng(seedA));
    const other = orderChoices(labels, createRng(seedB));
    expect(again).toEqual(first);
    expect(other).not.toEqual(first);
    expect([...first].sort()).toEqual([...labels]);
    expect(labels).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});

describe('журнал показанного текста', () => {
  it('view, step и summarize хранят подменённые situation и action', () => {
    const door = doorScenario();
    const shift = plan(door.id);
    const state = createState(shift, [door]);
    const screen = view(state, door, undefined, { textVariant: shown });
    expect(screen.text).toBe(shown.text);
    expect(screen.choices).toEqual([
      { id: 'inspect', text: 'Глянуть фиксатор и доложить начальнику' },
      { id: 'ignore', text: 'Пройти мимо в салон' },
    ]);

    const played = step(
      state,
      door,
      { choiceId: 'inspect' },
      { elapsedMs: 400, textVariant: shown },
    );
    expect(played.entry.situation).toBe(shown.text);
    expect(played.entry.action).toBe('Глянуть фиксатор и доложить начальнику');
    expect(played.entry.verdict).toBe('best');
    expect(played.entry.safetyDelta).toBe(10);
    expect(played.state.nodeId).toBe('n2');
    expect(played.state.safety).toBe(60);

    const plain = step(state, door, { choiceId: 'inspect' }, { elapsedMs: 400 });
    expect(plain.entry.situation).toBe(DOOR_TEXT);
    expect(plain.entry.action).toBe(INSPECT_TEXT);
    expect(plain.entry.verdict).toBe(played.entry.verdict);
    expect(plain.entry.safetyDelta).toBe(played.entry.safetyDelta);
    expect(plain.state.nodeId).toBe(played.state.nodeId);
    expect(plain.state.safety).toBe(played.state.safety);

    const summary = summarize(played.state, [door]);
    expect(summary.decisions[0]?.situation).toBe(shown.text);
    expect(summary.decisions[0]?.action).toBe('Глянуть фиксатор и доложить начальнику');
  });

  it('view перемешивает выборы тем же rng, что orderChoices', () => {
    const door = doorScenario();
    const state = createState(plan(door.id), [door]);
    const seedA = Buffer.alloc(32, 3);
    const seedB = Buffer.alloc(32, 9);
    const left = view(state, door, undefined, { rng: createRng(seedA) }).choices.map(
      (choice) => choice.id,
    );
    const leftAgain = view(state, door, undefined, { rng: createRng(seedA) }).choices.map(
      (choice) => choice.id,
    );
    const right = view(state, door, undefined, { rng: createRng(seedB) }).choices.map(
      (choice) => choice.id,
    );
    const expected = orderChoices(['inspect', 'ignore'], createRng(seedA));
    expect(leftAgain).toEqual(left);
    expect(left).toEqual(expected);
    expect(right).not.toEqual(left);
  });

  it('чужой вариант во view не затирает YAML', () => {
    const door = doorScenario();
    const state = createState(plan(door.id), [door]);
    const screen = view(state, door, undefined, {
      textVariant: { text: 'Не тот узел', choices: [{ id: 'close', text: 'Закрыть' }] },
    });
    expect(screen.text).toBe(DOOR_TEXT);
    expect(screen.choices[0]?.text).toBe(INSPECT_TEXT);
  });
});
