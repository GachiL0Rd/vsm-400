import { describe, expect, it } from 'vitest';
import {
  createEntityStore,
  type EntityPosition,
  type EntitySelector,
  type TraitExpiryScheduler,
  traitExpiryKey,
} from './entity-store';
import { EventQueue } from './event-queue';
import type { SimTimeUs } from './sim-time';

const cell = (cellId: string): EntityPosition => ({ kind: 'cell', cellId });

const businessAwake: EntitySelector = {
  op: 'all',
  selectors: [
    { op: 'kind', kind: 'passenger' },
    { op: 'trait', traitId: 'business' },
    { op: 'not', selector: { op: 'trait', traitId: 'sleeping' } },
  ],
};

type AttemptEvent =
  | { readonly kind: 'trait-expiry'; readonly key: string }
  | { readonly kind: 'marker'; readonly id: string };

function harness(rules: Parameters<typeof createEntityStore>[1] = []) {
  const queue = new EventQueue<AttemptEvent>();
  const scheduler: TraitExpiryScheduler = {
    schedule(at, key) {
      queue.schedule(at, { kind: 'trait-expiry', key }, key);
    },
    generation(key) {
      return queue.generation(key);
    },
    setGeneration(key, generation) {
      queue.setGeneration(key, generation);
    },
  };
  const store = createEntityStore(scheduler, rules);
  const applied: string[] = [];

  function advance(time: SimTimeUs): void {
    queue.advanceTo(
      time,
      () => undefined,
      (event) => {
        if (event.payload.kind === 'marker') {
          applied.push(event.payload.id);
          return;
        }
        applied.push(event.payload.key);
        store.applyTraitExpiry(event.payload.key, event.generation);
      },
    );
  }

  return { queue, store, applied, advance };
}

describe('entity store', () => {
  it('rejects duplicate entity and trait ids and keeps serialized traits sorted', () => {
    const { store } = harness();
    store.addPlayer({ id: 'conductor', position: cell('platform'), traits: ['on-duty'] });
    expect(() =>
      store.addPassenger({ id: 'conductor', position: cell('a'), traits: ['basic'] }),
    ).toThrow(RangeError);
    expect(() =>
      store.addPassenger({ id: 'p1', position: cell('a'), traits: ['basic', 'hungry', 'basic'] }),
    ).toThrow(RangeError);

    store.addPassenger({
      id: 'p2',
      position: cell('b'),
      traits: ['hungry', 'comfort', 'waiting-drink'],
    });
    store.addPassenger({ id: 'p1', position: cell('a'), traits: ['basic'] });

    const listed = store.list();
    expect(listed.map((entity) => entity.id)).toEqual(['conductor', 'p1', 'p2']);
    expect(listed[2]?.traits).toEqual(['comfort', 'hungry', 'waiting-drink']);
    expect(JSON.stringify(listed[1])).not.toContain('grantedAt');
  });

  it('expires traits on the shared queue and ignores a stale regrant', () => {
    const { store, advance } = harness();
    store.addPassenger({ id: 'p1', position: cell('a'), traits: ['basic'] });

    store.grantTrait('p1', 'impatient', 0, 1_000);
    store.grantTrait('p1', 'impatient', 0);
    expect(store.get('p1').traits).toEqual(['basic', 'impatient']);

    advance(400);
    store.grantTrait('p1', 'impatient', 400, 5_000);
    advance(1_000);
    expect(store.get('p1').traits).toContain('impatient');
    advance(5_400);
    expect(store.get('p1').traits).toEqual(['basic']);

    store.grantTrait('p1', 'hungry', 5_400, 2_000);
    store.removeTrait('p1', 'hungry');
    advance(5_500);
    store.grantTrait('p1', 'hungry', 5_500, 3_000);
    advance(7_400);
    expect(store.get('p1').traits).toContain('hungry');
    advance(8_500);
    expect(store.get('p1').traits).toEqual(['basic']);
  });

  it('orders same-timestamp expiry with other attempt events by schedule order', () => {
    const { queue, store, applied, advance } = harness();
    store.addPassenger({ id: 'p1', position: cell('a'), traits: ['basic'] });
    store.grantTrait('p1', 'hungry', 0, 1_000);
    queue.schedule(1_000, { kind: 'marker', id: 'between' });
    store.grantTrait('p1', 'impatient', 0, 1_000);

    advance(1_000);
    expect(applied).toEqual([
      traitExpiryKey('p1', 'hungry'),
      'between',
      traitExpiryKey('p1', 'impatient'),
    ]);
    expect(store.get('p1').traits).toEqual(['basic']);
  });

  it('does not let composite expiry keys collide when ids contain separators', () => {
    const { store, advance } = harness();
    const leftId = 'a\u0000b';
    const rightId = 'a';
    const leftTrait = 'c';
    const rightTrait = 'b\u0000c';
    expect(traitExpiryKey(leftId, leftTrait)).not.toBe(traitExpiryKey(rightId, rightTrait));

    store.addPassenger({ id: leftId, position: cell('a'), traits: ['basic'] });
    store.addPassenger({ id: rightId, position: cell('b'), traits: ['basic'] });
    store.grantTrait(leftId, leftTrait, 0, 1_000);
    store.grantTrait(rightId, rightTrait, 0, 1_000);
    store.removeTrait(leftId, leftTrait);

    advance(1_000);
    expect(store.get(leftId).traits).toEqual(['basic']);
    expect(store.get(rightId).traits).toEqual(['basic']);
  });

  it('rejects conflicting initial traits and keeps exactly one passenger service class', () => {
    const { store } = harness([{ id: 'sleeping', rejectIf: [{ op: 'trait', traitId: 'awake' }] }]);
    expect(() =>
      store.addPassenger({ id: 'none', position: cell('a'), traits: ['hungry'] }),
    ).toThrow(RangeError);
    expect(() =>
      store.addPassenger({ id: 'both', position: cell('a'), traits: ['basic', 'business'] }),
    ).toThrow(RangeError);
    expect(() =>
      store.addPassenger({
        id: 'asleep',
        position: cell('a'),
        traits: ['basic', 'awake', 'sleeping'],
      }),
    ).toThrow(RangeError);
    expect(() => store.addPlayer({ id: 'player', position: cell('a'), traits: ['basic'] })).toThrow(
      RangeError,
    );

    store.addPlayer({ id: 'player', position: cell('platform'), traits: [] });
    store.addPassenger({ id: 'p1', position: cell('a'), traits: ['comfort', 'awake'] });
    expect(() => store.grantTrait('p1', 'sleeping', 0)).toThrow(RangeError);
    expect(store.get('p1').traits).toEqual(['awake', 'comfort']);
    expect(() => store.grantTrait('p1', 'business', 0)).toThrow(RangeError);
    expect(() => store.removeTrait('p1', 'comfort')).toThrow(RangeError);
    expect(() => store.grantTrait('player', 'basic', 0)).toThrow(RangeError);

    store.setServiceClass('p1', 'business');
    expect(store.get('p1').traits).toEqual(['awake', 'business']);
    expect(store.select(businessAwake)).toEqual(['p1']);
  });

  it('allows one held item and one current action', () => {
    const { store } = harness();
    store.addPlayer({ id: 'player', position: cell('platform'), traits: [] });
    expect(store.setHeldItem('player', 'journal').heldItemId).toBe('journal');
    expect(() => store.setHeldItem('player', 'extinguisher')).toThrow(RangeError);
    expect(store.clearHeldItem('player').heldItemId).toBeUndefined();

    store.setCurrentAction('player', {
      actionId: 'request-drink',
      generation: 1,
      startedAt: 0,
      phase: { kind: 'waiting', timeoutAt: 1_000 },
    });
    expect(() =>
      store.setCurrentAction('player', {
        actionId: 'move',
        generation: 1,
        startedAt: 0,
        phase: { kind: 'running', completesAt: 10 },
      }),
    ).toThrow(RangeError);
    expect(store.clearCurrentAction('player').currentAction).toBeUndefined();
  });
});
