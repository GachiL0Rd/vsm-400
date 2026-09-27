import { describe, expect, it } from 'vitest';
import {
  type ActionContent,
  type ActionDefinition,
  type DecisionContext,
  loadActionContent,
  type TraitDefinition,
} from './action-decision';
import type { EntityState } from './entity-store';
import { createSimulationRandom } from './random';

function action(
  id: string,
  handler: ActionDefinition['handler'],
  baseLogit: number,
  patch: Partial<ActionDefinition> = {},
): ActionDefinition {
  return { id, handler, baseLogit, params: {}, ...patch };
}

function passenger(
  id: string,
  traits: string[],
  currentAction?: EntityState['currentAction'],
): EntityState {
  const entity: EntityState = {
    id,
    kind: 'passenger',
    position: { kind: 'cell', cellId: 'a' },
    traits,
  };
  if (currentAction === undefined) return entity;
  return { ...entity, currentAction };
}

function content(traits: TraitDefinition[], extra: ActionDefinition[] = []): ActionContent {
  return {
    actions: [
      action('wait', 'wait', 0),
      action('look', 'inspect', 0, { precondition: { op: 'trait', traitId: 'awake' } }),
      action('request-drink', 'request-item', -2, { params: { itemKind: 'drink' } }),
      action('complain', 'use-object', -1),
      ...extra,
    ],
    traits,
    baseActions: { player: ['wait'], passenger: ['wait', 'look'] },
  };
}

const behaviorTraits: TraitDefinition[] = [
  { id: 'basic' },
  { id: 'awake' },
  {
    id: 'thirsty',
    addActions: ['request-drink'],
    logitModifiers: [{ actionId: 'request-drink', curve: { kind: 'constant', value: 4 } }],
  },
  {
    id: 'business',
    logitModifiers: [
      { actionId: 'request-drink', curve: { kind: 'constant', value: 1 } },
      { actionId: 'complain', curve: { kind: 'constant', value: 0.5 } },
    ],
  },
  {
    id: 'waiting-drink',
    blacklistActions: [{ op: 'id', id: 'request-drink' }],
    logitModifiers: [{ actionId: 'wait', curve: { kind: 'constant', value: 2 } }],
  },
  {
    id: 'narrow-a',
    whitelistActions: [
      { op: 'id', id: 'request-drink' },
      { op: 'id', id: 'wait' },
    ],
  },
  {
    id: 'narrow-b',
    whitelistActions: [
      { op: 'id', id: 'request-drink' },
      { op: 'id', id: 'complain' },
    ],
  },
  {
    id: 'aging',
    logitModifiers: [
      {
        actionId: 'complain',
        curve: { kind: 'linear', origin: 1, slope: 0.5, time: 'traitAge' },
      },
    ],
  },
];

const now = 10;
const context: DecisionContext = {
  now,
  routeTime: 10,
  serviceWindowTime: 5,
  traitGrantedAt: { aging: 0 },
  environmentActionIds: ['complain'],
  contextModifiers: [
    {
      actionId: 'look',
      curve: { kind: 'sigmoid', origin: 0, height: 2, slope: 1, midpoint: 10, time: 'routeTime' },
    },
    {
      actionId: 'wait',
      curve: { kind: 'window', value: 4, start: 0, end: 10, time: 'serviceWindowTime' },
    },
  ],
};

describe('action decision', () => {
  it('filters candidates, intersects whitelists, then applies the blacklist', () => {
    const catalog = loadActionContent(content(behaviorTraits));
    const open = catalog.evaluate(
      passenger('p1', ['basic', 'awake', 'thirsty', 'business']),
      context,
    );
    expect(open.fallback).toBe(false);
    expect(open.candidates.map((candidate) => candidate.actionId)).toEqual([
      'complain',
      'look',
      'request-drink',
      'wait',
    ]);
    expect(open.candidates.map((candidate) => candidate.logit)).toEqual([-0.5, 1, 3, 4]);

    const narrowed = catalog.evaluate(
      passenger('p1', ['awake', 'basic', 'narrow-a', 'narrow-b', 'thirsty']),
      context,
    );
    expect(narrowed.candidates.map((candidate) => candidate.actionId)).toEqual(['request-drink']);

    const blocked = catalog.evaluate(
      passenger('p1', ['awake', 'basic', 'narrow-a', 'narrow-b', 'thirsty', 'waiting-drink']),
      context,
    );
    expect(blocked.fallback).toBe(true);
    expect(blocked.candidates.map((candidate) => candidate.actionId)).toEqual(['wait']);
    expect(blocked.candidates[0]?.logit).toBe(6);

    const asleep = catalog.evaluate(passenger('p1', ['basic']), {
      ...context,
      environmentActionIds: [],
      contextModifiers: [],
    });
    expect(asleep.candidates.map((candidate) => candidate.actionId)).toEqual(['wait']);
    expect(asleep.fallback).toBe(false);
  });

  it('evaluates linear, sigmoid, and window curves from explicit time sources', () => {
    const catalog = loadActionContent(content(behaviorTraits));
    const scored = catalog.evaluate(passenger('p1', ['aging', 'awake', 'basic']), context);
    expect(scored.candidates.find((candidate) => candidate.actionId === 'complain')?.logit).toBe(5);
    expect(scored.candidates.find((candidate) => candidate.actionId === 'look')?.logit).toBe(1);

    const closed = catalog.evaluate(passenger('p1', ['aging', 'awake', 'basic']), {
      ...context,
      serviceWindowTime: 10,
    });
    expect(closed.candidates.find((candidate) => candidate.actionId === 'wait')?.logit).toBe(0);
  });

  it('keeps softmax finite for extreme logits and repeats a seeded choice', () => {
    const catalog = loadActionContent({
      actions: [action('high', 'move', 1000), action('wait', 'wait', 0)],
      traits: [{ id: 'basic' }],
      baseActions: { player: ['wait'], passenger: ['high', 'wait'] },
    });
    const entity = passenger('p1', ['basic']);
    const extreme = catalog.evaluate(entity, { now: 0 });
    expect(extreme.candidates.map((candidate) => candidate.probability)).toEqual([1, 0]);
    expect(catalog.chooseNpcAction(createSimulationRandom(1), entity, { now: 0 }).status).toBe(
      'chosen',
    );
    const first = catalog.chooseNpcAction(createSimulationRandom(1), entity, { now: 0 });
    const second = catalog.chooseNpcAction(createSimulationRandom(99), entity, { now: 0 });
    expect(first).toEqual(second);
    if (first.status === 'chosen') expect(first.actionId).toBe('high');
  });

  it('reproduces one npc stream and does not let another npc stream change it', () => {
    const catalog = loadActionContent({
      actions: [action('alpha', 'move', 0), action('wait', 'wait', 0)],
      traits: [{ id: 'basic' }],
      baseActions: { player: ['wait'], passenger: ['alpha', 'wait'] },
    });
    const npc = passenger('alpha-npc', ['basic']);
    const other = passenger('beta-npc', ['basic']);
    const sample = (seed: number, disturb: boolean): string[] => {
      const random = createSimulationRandom(seed);
      if (disturb) {
        catalog.chooseNpcAction(random, other, { now: 0 });
        random.stream('npc:beta-npc:decision').nextUnit();
      }
      return [0, 1, 2, 3].map(() => {
        const decision = catalog.chooseNpcAction(random, npc, { now: 0 });
        return decision.status === 'chosen' ? decision.actionId : decision.status;
      });
    };

    expect(sample(11, false)).toEqual(sample(11, false));
    expect(sample(11, true)).toEqual(sample(11, false));

    const busyRandom = createSimulationRandom(11);
    catalog.chooseNpcAction(
      busyRandom,
      passenger('alpha-npc', ['basic'], {
        actionId: 'wait',
        generation: 1,
        startedAt: 0,
        phase: { kind: 'running', completesAt: 5 },
      }),
      { now: 0 },
    );
    const afterBusy = catalog.chooseNpcAction(busyRandom, npc, { now: 0 });
    const fresh = catalog.chooseNpcAction(createSimulationRandom(11), npc, { now: 0 });
    expect(afterBusy).toEqual(fresh);
  });

  it('rejects invalid action and trait content', () => {
    expect(() =>
      loadActionContent({
        actions: [action('wait', 'wait', 0), action('wait', 'wait', 1)],
        traits: [],
        baseActions: { player: ['wait'], passenger: ['wait'] },
      }),
    ).toThrow(RangeError);
    expect(() =>
      loadActionContent({
        actions: [action('look', 'inspect', 0)],
        traits: [],
        baseActions: { player: [], passenger: [] },
      }),
    ).toThrow(RangeError);
    expect(() => loadActionContent(content([{ id: 'basic', addActions: ['missing'] }]))).toThrow(
      RangeError,
    );
    expect(() =>
      loadActionContent(
        content([
          {
            id: 'basic',
            whitelistActions: [{ op: 'id', id: 'wait' }],
            blacklistActions: [{ op: 'id', id: 'wait' }],
          },
        ]),
      ),
    ).toThrow(RangeError);
    expect(() =>
      loadActionContent(content([{ id: 'basic' }], [action('bad', 'dance', 0)])),
    ).toThrow(RangeError);
    expect(() =>
      loadActionContent(
        content([{ id: 'basic' }], [action('bad', 'move', 0, { params: { level: Number.NaN } })]),
      ),
    ).toThrow(RangeError);
    expect(() => loadActionContent(content([{ id: 'basic', speech: '  ' }]))).toThrow(RangeError);
    expect(() =>
      loadActionContent(content([{ id: 'basic' }], [action('shout', 'wait', 0, { speech: '' })])),
    ).toThrow(RangeError);
    const spoken = loadActionContent(
      content([{ id: 'basic', speech: 'Алло' }], [action('shout', 'wait', 1, { speech: 'Эй' })]),
    );
    expect(spoken.traitSpeech('basic')).toBe('Алло');
    expect(spoken.actionSpeech('shout')).toBe('Эй');
    expect(spoken.actionSpeech('missing')).toBeUndefined();
    expect(spoken.traitSpeech('missing')).toBeUndefined();
    expect(() =>
      loadActionContent(
        content([
          {
            id: 'basic',
            logitModifiers: [
              {
                actionId: 'wait',
                curve: { kind: 'window', value: 1, start: 4, end: 4, time: 'routeTime' },
              },
            ],
          },
        ]),
      ),
    ).toThrow(RangeError);
  });

  it('allows a blacklist to remove one option from a broader whitelist', () => {
    const catalog = loadActionContent(
      content([
        {
          id: 'basic',
          whitelistActions: [
            { op: 'id', id: 'wait' },
            { op: 'id', id: 'look' },
          ],
          blacklistActions: [{ op: 'id', id: 'wait' }],
        },
        { id: 'awake' },
      ]),
    );
    expect(catalog.evaluate(passenger('p', ['basic', 'awake']), { now: 0 }).candidates).toEqual([
      { actionId: 'look', logit: 0, probability: 1 },
    ]);
  });
});
