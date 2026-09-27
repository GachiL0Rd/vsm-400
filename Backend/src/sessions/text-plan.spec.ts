import { describe, expect, it } from 'vitest';
import { createRng } from '../engine/rng';
import type { ScenarioGraph } from '../engine/schema';

import type { ShiftPlan } from '../engine/types';
import {
  assembleTextPlan,
  livePinTarget,
  markShown,
  orderRng,
  payloadVariant,
  personaOf,
  pickApprovedId,
  readTextPlan,
  textPlanKey,
  writeTextPlan,
} from './text-plan';

const seedA = Buffer.alloc(32, 4);

function graph(id: string, mode: 'pool' | 'live' | 'off'): ScenarioGraph {
  const base: ScenarioGraph = {
    id,
    title: id,
    category: 'service',
    stage: 'acceptance',
    carClasses: ['ECONOMY'],
    difficulty: 1,
    competencies: ['service'],
    init: { loyalty: 60, safety: 60 },
    start: 'door',
    nodes: {
      door: {
        text: 'Исходная ситуация',
        timer: 20,
        choices: [
          {
            id: 'do',
            text: 'Сделать по регламенту',
            effects: { safety: 5, loyalty: 5 },
            verdict: 'best',
            next: 'end',
          },
          {
            id: 'skip',
            text: 'Пропустить',
            effects: { safety: -5 },
            verdict: 'worse',
            next: 'end',
          },
        ],
      },
      end: { end: 'completed', text: 'Готово' },
    },
  };
  if (mode === 'off') {
    return base;
  }
  return {
    ...base,
    llm: { enabled: true, mode, personas: ['тихий', 'раздражённый'] },
  };
}

function shift(ids: readonly { id: string; version: number }[]): ShiftPlan {
  return {
    train: 'ВСМ 701',
    route: 'Москва-Петербург',
    fromStation: 'Москва',
    toStation: 'Санкт-Петербург',
    stops: [],
    car: 1,
    carClass: 'ECONOMY',
    departure: '06:20',
    scenarios: ids.map((item) => ({
      scenarioId: item.id,
      version: item.version,
      params: {},
    })),
  };
}

describe('план текстов', () => {
  it('одинаковый seed выбирает один и тот же id из списка, отсортированного по id', () => {
    const ids = ['b', 'a', 'c'];
    const left = pickApprovedId(createRng(seedA), 'sc', 'door', ids);
    const right = pickApprovedId(createRng(seedA), 'sc', 'door', ['c', 'b', 'a']);
    const expected = createRng(seedA).fork('text:sc:door').pick(['a', 'b', 'c']);
    expect(left).toBe(expected);
    expect(right).toBe(left);
    expect(pickApprovedId(createRng(seedA), 'sc', 'door', [])).toBeNull();
  });

  it('одинаковый seed даёт один план и одну персону, выключенный сценарий не входит', () => {
    const plans = [seedA, seedA].map((seed) =>
      assembleTextPlan(
        createRng(seed),
        shift([
          { id: 'off', version: 1 },
          { id: 'on', version: 2 },
        ]),
        [graph('off', 'off'), graph('on', 'pool')],
        (query) => (query.scenarioId === 'on' && query.persona.length > 0 ? ['b', 'a'] : []),
      ),
    );
    expect(plans[1]).toEqual(plans[0]);
    const persona = personaOf(createRng(seedA), graph('on', 'pool'));
    expect(persona.length).toBeGreaterThan(0);
    expect(personaOf(createRng(seedA), graph('on', 'pool'))).toBe(persona);
    const key = textPlanKey('on', 'door');
    expect(plans[0]?.textPlan).toEqual({
      [key]: createRng(seedA).fork('text:on:door').pick(['a', 'b']),
    });
    expect(plans[0]?.live).toEqual([]);
    expect(plans[0]?.textPlan).not.toHaveProperty(textPlanKey('on', 'end'));
    expect(plans[0]?.textPlan).not.toHaveProperty(textPlanKey('off', 'door'));
  });

  it('live без APPROVED кладёт null и просит генерацию, pool молчит', () => {
    const live = assembleTextPlan(
      createRng(seedA),
      shift([{ id: 'on', version: 3 }]),
      [graph('on', 'live')],
      () => [],
    );
    const persona = personaOf(createRng(seedA), graph('on', 'live'));
    expect(live.textPlan).toEqual({ [textPlanKey('on', 'door')]: null });
    expect(live.live).toEqual([{ scenarioId: 'on', version: 3, nodeId: 'door', persona }]);
    const pool = assembleTextPlan(
      createRng(seedA),
      shift([{ id: 'on', version: 3 }]),
      [graph('on', 'pool')],
      () => [],
    );
    expect(pool.live).toEqual([]);
    expect(pool.textPlan).toEqual({ [textPlanKey('on', 'door')]: null });
  });

  it('разный seed меняет fork порядка, повтор того же seed — нет', () => {
    const draw = (byte: number): number =>
      orderRng(createRng(Buffer.alloc(32, byte)), 'sc', 'door', 0).nextFloat();
    expect(draw(1)).toBe(draw(1));
    expect(draw(2)).not.toBe(draw(1));
  });

  it('показанный пустой слот больше не живой', () => {
    const key = textPlanKey('on', 'door');
    const open = { nodes: { [key]: null }, shown: [] as string[] };
    expect(livePinTarget(open, key, 'live')).toBe(true);
    expect(livePinTarget(open, key, 'pool')).toBe(false);
    expect(livePinTarget(open, key, null)).toBe(false);
    const frozen = markShown(open, key, null);
    expect(livePinTarget(frozen, key, 'live')).toBe(false);
    expect(livePinTarget(markShown(open, key, 'variant-1'), key, 'live')).toBe(false);
    expect(writeTextPlan(frozen)).toEqual({ [key]: null, _shown: [key] });
    expect(readTextPlan(writeTextPlan(frozen))).toEqual(frozen);
  });

  it('битый payload не становится вариантом', () => {
    expect(payloadVariant({ text: 'А', choices: [{ id: 'do', text: 'Б' }] })).toEqual({
      text: 'А',
      choices: [{ id: 'do', text: 'Б' }],
    });
    expect(payloadVariant({ text: 1, choices: [] })).toBeUndefined();
    expect(payloadVariant(null)).toBeUndefined();
  });
});
