import { describe, expect, it } from 'vitest';
import { type CurrentAction, createEntityStore, type EntityStore } from './entity-store';
import {
  createItemStore,
  type ItemStore,
  type ItemWorldConfig,
  itemGivenMatchesWaitingAction,
} from './item-store';

const config: ItemWorldConfig = {
  journal: { id: 'journal', homeAnchorId: 'platform.acceptance-desk', homeCellId: 'platform' },
  extinguisher: {
    id: 'extinguisher',
    mountAnchorId: 'cabin.extinguisher-mount',
    mountCellId: 'cabin',
    pressure: 'low',
    bodyDamage: 'scratch',
  },
  servicePoint: { id: 'service-point', cellId: 'service' },
};

function waiting(actionId: string, generation: number): CurrentAction {
  return { actionId, generation, startedAt: 0, phase: { kind: 'waiting', timeoutAt: 1_000 } };
}

function setup(): { entities: EntityStore; items: ItemStore } {
  const entities = createEntityStore({
    scheduleReplacing() {
      return 1;
    },
    generation() {
      return 0;
    },
    setGeneration() {
      return undefined;
    },
  });
  entities.addPlayer({ id: 'player', position: { kind: 'cell', cellId: 'platform' }, traits: [] });
  entities.addPassenger({
    id: 'passenger',
    position: { kind: 'cell', cellId: 'seat' },
    traits: ['basic'],
  });
  return { entities, items: createItemStore(entities, config) };
}

describe('item store', () => {
  it('leaves the journal blank until the player edits it', () => {
    const { entities, items } = setup();
    const initial = items.snapshot();
    expect(initial.journal).toMatchObject({
      location: 'anchor',
      homeAnchorId: 'platform.acceptance-desk',
      communication: 'unset',
      extinguisher: 'unset',
      climate: 'unset',
      emergencyBrake: 'unset',
      sanitation: 'unset',
      note: '',
      accepted: false,
      submitted: false,
    });
    expect(initial.extinguisher.pressure).toBe('low');
    expect(initial.extinguisher.bodyDamage).toBe('scratch');

    entities.setPosition('player', { kind: 'cell', cellId: 'cabin' });
    expect(() => items.takeJournal('player')).toThrow(RangeError);
    expect(items.snapshot().journal.location).toBe('anchor');
    expect(entities.get('player').heldItemId).toBeUndefined();

    entities.setPosition('player', { kind: 'cell', cellId: 'platform' });
    items.takeJournal('player');
    items.setJournalEntry('player', 'communication', 'ok');
    items.setJournalNote('player', 'door seal');
    items.markJournalAccepted('player');
    const edited = items.snapshot().journal;
    expect(edited).toMatchObject({
      communication: 'ok',
      extinguisher: 'unset',
      climate: 'unset',
      emergencyBrake: 'unset',
      sanitation: 'unset',
      note: 'door seal',
      accepted: true,
      submitted: false,
    });

    entities.setPosition('player', { kind: 'cell', cellId: 'cabin' });
    expect(() => items.returnJournal('player')).toThrow(RangeError);
    expect(entities.get('player').heldItemId).toBe('journal');

    entities.setPosition('player', { kind: 'cell', cellId: 'platform' });
    const returned = items.returnJournal('player');
    expect(returned.location).toBe('anchor');
    expect(returned.submitted).toBe(true);
    expect(returned.extinguisher).toBe('unset');
    expect(entities.get('player').heldItemId).toBeUndefined();
    expect(entities.list().map((entity) => entity.id)).toEqual(['passenger', 'player']);
  });

  it('prepares a held extinguisher before use and rejects the wrong holder or place', () => {
    const { entities, items } = setup();
    const before = items.snapshot();
    entities.setPosition('player', { kind: 'cell', cellId: 'platform' });
    expect(() => items.takeExtinguisher('player')).toThrow(RangeError);
    expect(() => items.prepareExtinguisher('player')).toThrow(RangeError);
    expect(items.snapshot()).toEqual(before);

    entities.setPosition('player', { kind: 'cell', cellId: 'cabin' });
    items.takeExtinguisher('player');
    expect(items.inspectExtinguisher('player')).toMatchObject({
      location: 'held',
      holderId: 'player',
      pin: 'present',
      seal: 'intact',
      used: false,
    });
    expect(() => items.useExtinguisher('player', 'fire-cell')).toThrow(RangeError);
    expect(items.snapshot().extinguisher.used).toBe(false);

    items.prepareExtinguisher('player');
    expect(items.snapshot().extinguisher).toMatchObject({
      pin: 'removed',
      seal: 'broken',
      used: false,
    });
    const used = items.useExtinguisher('player', 'fire-cell');
    expect(used).toEqual({
      type: 'extinguisher-used',
      holderId: 'player',
      itemId: 'extinguisher',
      targetId: 'fire-cell',
    });
    expect(() => items.useExtinguisher('player', 'fire-cell')).toThrow(RangeError);
    expect(items.snapshot().extinguisher.used).toBe(true);
    expect(entities.get('player').heldItemId).toBe('extinguisher');
  });

  it('issues deterministic food and drink ids and gives them only beside the passenger', () => {
    const { entities, items } = setup();
    entities.setPosition('player', { kind: 'cell', cellId: 'platform' });
    expect(() => items.takeDrink('player')).toThrow(RangeError);
    expect(items.snapshot().consumables).toEqual([]);

    entities.setPosition('player', { kind: 'cell', cellId: 'service' });
    expect(items.takeDrink('player')).toMatchObject({
      id: 'drink-1',
      kind: 'drink',
      location: 'held',
    });
    expect(() => items.takeFood('player')).toThrow(RangeError);
    expect(items.snapshot().consumables.map((item) => item.id)).toEqual(['drink-1']);

    entities.setCurrentAction('passenger', waiting('request-drink', 4));
    expect(() => items.giveConsumable('player', 'passenger')).toThrow(RangeError);
    expect(entities.get('player').heldItemId).toBe('drink-1');

    entities.setPosition('player', { kind: 'cell', cellId: 'seat' });
    const given = items.giveConsumable('player', 'passenger');
    expect(given).toEqual({
      type: 'item-given',
      giverId: 'player',
      targetId: 'passenger',
      itemId: 'drink-1',
      itemKind: 'drink',
      waitingActionGeneration: 4,
    });
    expect(itemGivenMatchesWaitingAction(given, waiting('request-drink', 4))).toBe(true);
    expect(itemGivenMatchesWaitingAction(given, waiting('request-food', 4))).toBe(false);
    expect(itemGivenMatchesWaitingAction(given, waiting('request-drink', 5))).toBe(false);
    expect(entities.get('player').heldItemId).toBeUndefined();
    expect(entities.get('passenger').heldItemId).toBeUndefined();
    expect(items.snapshot().consumables[0]).toMatchObject({
      id: 'drink-1',
      location: 'given',
      givenToId: 'passenger',
    });

    entities.setPosition('player', { kind: 'cell', cellId: 'service' });
    expect(items.takeFood('player').id).toBe('food-1');
    expect(() => items.takeDrink('player')).toThrow(RangeError);
    entities.setPosition('player', { kind: 'cell', cellId: 'seat' });
    const food = items.giveConsumable('player', 'passenger');
    expect(food.itemId).toBe('food-1');
    expect(food.waitingActionGeneration).toBeNull();
    entities.setPosition('player', { kind: 'cell', cellId: 'service' });
    expect(items.takeDrink('player').id).toBe('drink-2');
  });

  it('keeps a private config copy and refuses generated item ids', () => {
    const { entities } = setup();
    const mutable = {
      journal: { id: 'journal', homeAnchorId: 'desk', homeCellId: 'platform' },
      extinguisher: {
        id: 'extinguisher',
        mountAnchorId: 'mount',
        mountCellId: 'cabin',
        pressure: 'normal',
        bodyDamage: 'none',
      },
      servicePoint: { id: 'service-point', cellId: 'service' },
    } satisfies ItemWorldConfig;
    const items = createItemStore(entities, mutable);
    mutable.journal.homeCellId = 'cabin';
    items.takeJournal('player');
    expect(entities.get('player').heldItemId).toBe('journal');
    expect(items.snapshot().journal.homeCellId).toBe('platform');

    expect(() =>
      createItemStore(entities, {
        ...config,
        journal: { ...config.journal, id: 'food-1' },
      }),
    ).toThrow(RangeError);
    expect(() =>
      createItemStore(entities, {
        ...config,
        extinguisher: { ...config.extinguisher, id: 'drink-2' },
      }),
    ).toThrow(RangeError);
  });

  it('leaves the held slot and item state unchanged when a command is rejected', () => {
    const { entities, items } = setup();
    entities.setPosition('player', { kind: 'cell', cellId: 'cabin' });
    items.takeExtinguisher('player');
    const held = entities.get('player').heldItemId;
    const before = items.snapshot();

    expect(() => items.takeJournal('player')).toThrow(RangeError);
    expect(() => items.takeDrink('player')).toThrow(RangeError);
    expect(() => items.prepareExtinguisher('passenger')).toThrow(RangeError);
    expect(() => items.giveConsumable('player', 'passenger')).toThrow(RangeError);

    expect(entities.get('player').heldItemId).toBe(held);
    expect(entities.get('passenger').heldItemId).toBeUndefined();
    expect(items.snapshot()).toEqual(before);
  });
});
