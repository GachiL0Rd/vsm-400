import { describe, expect, it } from 'vitest';
import { type ActionContent, loadActionContent } from './action-decision';
import {
  type ActionRuntimeEvent,
  type ActionRuntimeScheduler,
  createActionRuntime,
  createRequestItemActionHandler,
  createWaitActionHandler,
} from './action-runtime';
import { createEntityStore, type TraitExpiryScheduler } from './entity-store';
import { EventQueue } from './event-queue';
import { createItemStore, type ItemEvent, type ItemWorldConfig } from './item-store';
import { type SimTimeUs, secondsToSimTimeUs } from './sim-time';

const itemConfig: ItemWorldConfig = {
  journal: { id: 'journal', homeAnchorId: 'platform.desk', homeCellId: 'platform' },
  extinguisher: {
    id: 'extinguisher',
    mountAnchorId: 'cabin.mount',
    mountCellId: 'cabin',
    pressure: 'normal',
    bodyDamage: 'none',
  },
  servicePoint: { id: 'service-point', cellId: 'service' },
};

const content: ActionContent = {
  actions: [
    { id: 'wait', handler: 'wait', baseLogit: 0, params: { durationSeconds: 1 } },
    {
      id: 'request-drink',
      handler: 'request-item',
      baseLogit: 3,
      params: {
        itemKind: 'drink',
        waitingTrait: 'waiting-drink',
        timeoutSeconds: 120,
        receivedTrait: 'has-drink',
        timeoutTrait: 'annoyed',
      },
    },
    {
      id: 'request-food',
      handler: 'request-item',
      baseLogit: 3,
      params: {
        itemKind: 'food',
        waitingTrait: 'waiting-food',
        timeoutSeconds: 2,
        receivedTrait: 'has-food',
        timeoutTrait: 'annoyed',
      },
    },
  ],
  traits: [
    { id: 'basic' },
    { id: 'thirsty', addActions: ['request-drink'] },
    { id: 'hungry', addActions: ['request-food'] },
    { id: 'waiting-drink' },
    { id: 'waiting-food' },
    { id: 'has-drink' },
    { id: 'has-food' },
    { id: 'annoyed' },
  ],
  baseActions: { player: ['wait'], passenger: ['wait'] },
};

type AttemptEvent =
  | { readonly kind: 'action'; readonly event: ActionRuntimeEvent }
  | { readonly kind: 'trait-expiry'; readonly key: string }
  | { readonly kind: 'item'; readonly event: ItemEvent };

function setup() {
  const queue = new EventQueue<AttemptEvent>();
  const traitScheduler: TraitExpiryScheduler = {
    scheduleReplacing(at, key) {
      const event = queue.scheduleReplacing(at, { kind: 'trait-expiry', key }, key);
      if (event.generation === null) throw new RangeError('Expiry generation is missing');
      return event.generation;
    },
    generation(key) {
      return queue.generation(key);
    },
    setGeneration(key, generation) {
      queue.setGeneration(key, generation);
    },
  };
  const actionScheduler: ActionRuntimeScheduler = {
    schedule(at, event, generationKey) {
      queue.schedule(at, { kind: 'action', event }, generationKey);
    },
    generation(key) {
      return queue.generation(key);
    },
    setGeneration(key, generation) {
      queue.setGeneration(key, generation);
    },
  };

  const entities = createEntityStore(traitScheduler);
  entities.addPlayer({ id: 'player', position: { kind: 'cell', cellId: 'service' }, traits: [] });
  entities.addPassenger({
    id: 'passenger',
    position: { kind: 'cell', cellId: 'seat' },
    traits: ['basic', 'hungry', 'thirsty'],
  });
  const items = createItemStore(entities, itemConfig);
  const catalog = loadActionContent(content);
  const runtime = createActionRuntime({
    catalog,
    entities,
    scheduler: actionScheduler,
    handlers: {
      wait: createWaitActionHandler(),
      'request-item': createRequestItemActionHandler(),
    },
  });
  const applied: string[] = [];

  function advance(time: SimTimeUs): void {
    queue.advanceTo(
      time,
      () => undefined,
      (scheduled) => {
        const payload = scheduled.payload;
        if (payload.kind === 'action') {
          applied.push(payload.event.kind);
          runtime.apply(payload.event, scheduled.at);
          return;
        }
        if (payload.kind === 'trait-expiry') {
          applied.push('trait-expiry');
          entities.applyTraitExpiry(payload.key, scheduled.generation);
          return;
        }
        applied.push(payload.event.type);
        runtime.handleExternalEvent(payload.event, scheduled.at);
      },
    );
  }

  return { queue, entities, items, catalog, runtime, applied, advance };
}

describe('action runtime', () => {
  it('resolves a waiting request from an external item event at the same simulation time', () => {
    const { queue, entities, items, runtime, applied, advance } = setup();

    const start = runtime.start({
      actorId: 'passenger',
      actionId: 'request-drink',
      now: 0,
      decisionContext: { now: 0 },
    });
    expect(start.status).toBe('started');
    expect(entities.get('passenger')).toMatchObject({
      traits: ['basic', 'hungry', 'thirsty', 'waiting-drink'],
      currentAction: {
        actionId: 'request-drink',
        generation: 1,
        phase: { kind: 'waiting', timeoutAt: secondsToSimTimeUs(120) },
      },
    });

    items.takeDrink('player');
    entities.setPosition('player', { kind: 'cell', cellId: 'seat' });
    const given = items.giveConsumable('player', 'passenger');
    queue.schedule(secondsToSimTimeUs(5), { kind: 'item', event: given });

    advance(secondsToSimTimeUs(5));
    expect(applied).toEqual(['item-given', 'resolve']);
    expect(entities.get('passenger').currentAction).toBeUndefined();
    expect(entities.get('passenger').traits).toEqual(['basic', 'has-drink', 'hungry', 'thirsty']);

    advance(secondsToSimTimeUs(120));
    expect(applied).toEqual(['item-given', 'resolve']);
    expect(entities.get('passenger').traits).not.toContain('annoyed');
  });

  it('finishes a waiting action by timeout and returns to a decision-ready state', () => {
    const { entities, runtime, applied, advance } = setup();

    runtime.start({
      actorId: 'passenger',
      actionId: 'request-food',
      now: 0,
      decisionContext: { now: 0 },
    });
    expect(entities.get('passenger').traits).toContain('waiting-food');

    advance(secondsToSimTimeUs(2));
    expect(applied).toEqual(['timeout']);
    expect(entities.get('passenger').currentAction).toBeUndefined();
    expect(entities.get('passenger').traits).toEqual(['annoyed', 'basic', 'hungry', 'thirsty']);
  });

  it('completes and interrupts running actions through generation-checked queue events', () => {
    const { entities, runtime, applied, advance } = setup();

    runtime.start({
      actorId: 'passenger',
      actionId: 'wait',
      now: 0,
      decisionContext: { now: 0 },
    });
    advance(secondsToSimTimeUs(1));
    expect(applied).toEqual(['complete']);
    expect(entities.get('passenger').currentAction).toBeUndefined();

    runtime.start({
      actorId: 'passenger',
      actionId: 'wait',
      now: secondsToSimTimeUs(1),
      decisionContext: { now: secondsToSimTimeUs(1) },
    });
    expect(runtime.interrupt('passenger', secondsToSimTimeUs(1))).toBe(true);
    advance(secondsToSimTimeUs(1));
    expect(applied).toEqual(['complete', 'resolve']);
    expect(entities.get('passenger').currentAction).toBeUndefined();

    advance(secondsToSimTimeUs(2));
    expect(applied).toEqual(['complete', 'resolve']);
  });

  it('revalidates availability before start and exposes immutable action definitions', () => {
    const { catalog, runtime } = setup();
    expect(() =>
      runtime.start({
        actorId: 'player',
        actionId: 'request-drink',
        now: 0,
        decisionContext: { now: 0 },
      }),
    ).toThrow(RangeError);

    const definition = catalog.definition('request-drink');
    expect(definition).toMatchObject({ id: 'request-drink', handler: 'request-item' });
    expect(definition.params).not.toBe(catalog.definition('request-drink').params);
  });
});
