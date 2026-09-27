import { describe, expect, it } from 'vitest';
import { createActionRuntime } from './action-runtime';
import type { ItemWorldConfig } from './item-store';

const config: ItemWorldConfig = {
  journal: { id: 'journal', homeAnchorId: 'desk', homeCellId: 'platform' },
  extinguisher: {
    id: 'extinguisher',
    mountAnchorId: 'mount',
    mountCellId: 'cabin',
    pressure: 'normal',
    bodyDamage: 'none',
  },
  servicePoint: { id: 'service-point', cellId: 'service' },
};

function setup(traits: string[] = ['business', 'thirsty']) {
  const runtime = createActionRuntime(config);
  runtime.entities.addPlayer({
    id: 'player',
    position: { kind: 'cell', cellId: 'service' },
    traits: [],
  });
  runtime.entities.addPassenger({
    id: 'passenger',
    position: { kind: 'cell', cellId: 'seat' },
    traits,
  });
  return runtime;
}

describe('request action runtime', () => {
  it('resolves a drink request after ItemGiven in later same-time order', () => {
    const runtime = setup();
    const action = runtime.startRequest('passenger', 'drink', 0, 120);
    expect(action).toMatchObject({
      actionId: 'request-drink',
      phase: { kind: 'waiting', timeoutAt: 120 },
    });
    expect(runtime.entities.get('passenger').traits).toContain('waiting-drink');

    runtime.items.takeDrink('player');
    runtime.entities.setPosition('player', { kind: 'cell', cellId: 'seat' });
    runtime.giveItem('player', 'passenger', 0);
    expect(runtime.entities.get('player').heldItemId).toBe('drink-1');
    runtime.advanceTo(0);

    expect(runtime.events().map((event) => event.type)).toEqual(['item-given', 'request-outcome']);
    expect(runtime.events()[1]).toMatchObject({ outcome: 'success', itemKind: 'drink', at: 0 });
    expect(runtime.entities.get('passenger')).toMatchObject({
      traits: ['business', 'has-drink'],
    });
    expect(runtime.entities.get('passenger').currentAction).toBeUndefined();
    expect(runtime.entities.get('player').heldItemId).toBeUndefined();

    runtime.advanceTo(120);
    expect(runtime.events()).toHaveLength(2);
  });

  it('times out a food request and ignores an interrupted stale timeout', () => {
    const runtime = setup(['basic', 'hungry']);
    runtime.startRequest('passenger', 'food', 0, 100);
    runtime.interrupt('passenger', 0);
    expect(runtime.events()[0]).toMatchObject({ outcome: 'interrupted' });
    expect(runtime.entities.get('passenger').traits).toEqual(['basic', 'hungry']);

    const newAction = runtime.startRequest('passenger', 'food', 0, 200);
    runtime.advanceTo(100);
    expect(runtime.entities.get('passenger').currentAction?.generation).toBe(newAction.generation);
    expect(runtime.events()).toHaveLength(1);

    runtime.advanceTo(200);
    expect(runtime.events()[1]).toMatchObject({ outcome: 'timeout', itemKind: 'food', at: 200 });
    expect(runtime.entities.get('passenger').traits).toEqual(['annoyed', 'basic', 'hungry']);
    expect(runtime.entities.get('passenger').currentAction).toBeUndefined();
  });

  it('rejects wrong item, distance and missing need without changing held state', () => {
    const runtime = setup();
    expect(() => runtime.startRequest('passenger', 'food', 0, 100)).toThrow(RangeError);
    expect(runtime.entities.get('passenger').currentAction).toBeUndefined();
    runtime.startRequest('passenger', 'drink', 0, 100);
    runtime.items.takeFood('player');
    const before = runtime.items.snapshot();
    expect(() => runtime.giveItem('player', 'passenger', 0)).toThrow(RangeError);
    expect(runtime.items.snapshot()).toEqual(before);

    const second = setup();
    second.startRequest('passenger', 'drink', 0, 100);
    second.items.takeDrink('player');
    expect(() => second.giveItem('player', 'passenger', 0)).toThrow(RangeError);
    expect(second.entities.get('player').heldItemId).toBe('drink-1');
    second.advanceTo(100);
    expect(() => second.giveItem('player', 'passenger', 100)).toThrow(RangeError);
    expect(second.entities.get('player').heldItemId).toBe('drink-1');
  });

  it('uses the same queue for temporary traits and request events', () => {
    const runtime = setup();
    runtime.entities.grantTrait('passenger', 'alert', 0, 10);
    runtime.startRequest('passenger', 'drink', 0, 20);
    runtime.advanceTo(10);
    expect(runtime.entities.get('passenger').traits).not.toContain('alert');
    expect(runtime.entities.get('passenger').traits).toContain('waiting-drink');
    runtime.advanceTo(20);
    expect(runtime.events()).toMatchObject([{ type: 'request-outcome', outcome: 'timeout' }]);
  });
});
