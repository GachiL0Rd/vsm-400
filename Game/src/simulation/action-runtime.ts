import { type CurrentAction, createEntityStore, type EntityStore } from './entity-store';
import { EventQueue, type ScheduledEvent } from './event-queue';
import {
  type ConsumableKind,
  createItemStore,
  type ItemGiven,
  type ItemStore,
  type ItemWorldConfig,
} from './item-store';
import { assertSimTimeUs, type SimTimeUs } from './sim-time';

type TimelineEvent =
  | { readonly kind: 'trait-expiry'; readonly key: string }
  | { readonly kind: 'request-timeout'; readonly passengerId: string }
  | { readonly kind: 'give-item'; readonly playerId: string; readonly passengerId: string }
  | {
      readonly kind: 'resolve-request';
      readonly passengerId: string;
      readonly itemKind: ConsumableKind;
    };

export interface RequestOutcome {
  readonly type: 'request-outcome';
  readonly passengerId: string;
  readonly itemKind: ConsumableKind;
  readonly outcome: 'success' | 'timeout' | 'interrupted';
  readonly at: SimTimeUs;
}

export interface RejectedGive {
  readonly type: 'give-rejected';
  readonly playerId: string;
  readonly passengerId: string;
  readonly at: SimTimeUs;
}

export type ActionRuntimeEvent = ItemGiven | RequestOutcome | RejectedGive;

export interface ActionRuntime {
  readonly entities: EntityStore;
  readonly items: ItemStore;
  readonly queue: EventQueue<TimelineEvent>;
  startRequest(
    passengerId: string,
    itemKind: ConsumableKind,
    at: SimTimeUs,
    timeoutDuration: SimTimeUs,
  ): CurrentAction;
  giveItem(playerId: string, passengerId: string, at: SimTimeUs): void;
  interrupt(passengerId: string, at: SimTimeUs): RequestOutcome;
  advanceTo(at: SimTimeUs): void;
  events(): readonly ActionRuntimeEvent[];
}

const waitingTrait = (kind: ConsumableKind): string => `waiting-${kind}`;
const needTrait = (kind: ConsumableKind): string => (kind === 'drink' ? 'thirsty' : 'hungry');
const requestId = (kind: ConsumableKind): string => `request-${kind}`;
const actionKey = (id: string): string => `request/${id.length}:${id}`;

export function createActionRuntime(config: ItemWorldConfig): ActionRuntime {
  return new RequestActionRuntime(config);
}

class RequestActionRuntime implements ActionRuntime {
  readonly queue = new EventQueue<TimelineEvent>();
  readonly entities: EntityStore;
  readonly items: ItemStore;
  private readonly emitted: ActionRuntimeEvent[] = [];

  constructor(config: ItemWorldConfig) {
    this.entities = createEntityStore({
      scheduleReplacing: (at, key) => {
        const event = this.queue.scheduleReplacing(at, { kind: 'trait-expiry', key }, key);
        if (event.generation === null) throw new RangeError('Trait expiry generation is missing');
        return event.generation;
      },
      generation: (key) => this.queue.generation(key),
      setGeneration: (key, generation) => this.queue.setGeneration(key, generation),
    });
    this.items = createItemStore(this.entities, config);
  }

  startRequest(
    passengerId: string,
    itemKind: ConsumableKind,
    at: SimTimeUs,
    timeoutDuration: SimTimeUs,
  ): CurrentAction {
    this.requireNow(at);
    const duration = assertSimTimeUs(timeoutDuration);
    if (duration <= 0) throw new RangeError('Request timeout must be positive');
    if (itemKind !== 'food' && itemKind !== 'drink') throw new RangeError('Unknown item kind');
    const passenger = this.entities.get(passengerId);
    if (passenger.kind !== 'passenger' || passenger.currentAction !== undefined) {
      throw new RangeError('Only an idle passenger may request an item');
    }
    if (!passenger.traits.includes(needTrait(itemKind))) {
      throw new RangeError('Passenger has no matching service need');
    }
    const timeoutAt = at + duration;
    if (!Number.isSafeInteger(timeoutAt)) throw new RangeError('Request timeout is out of range');
    const scheduled = this.queue.scheduleReplacing(
      timeoutAt,
      { kind: 'request-timeout', passengerId },
      actionKey(passengerId),
    );
    if (scheduled.generation === null) throw new RangeError('Request generation is missing');
    const action: CurrentAction = {
      actionId: requestId(itemKind),
      generation: scheduled.generation,
      startedAt: at,
      phase: { kind: 'waiting', timeoutAt },
    };
    this.entities.grantTrait(passengerId, waitingTrait(itemKind), at);
    this.entities.setCurrentAction(passengerId, action);
    return action;
  }

  giveItem(playerId: string, passengerId: string, at: SimTimeUs): void {
    this.requireNow(at);
    this.requireGive(playerId, passengerId);
    this.queue.schedule(at, { kind: 'give-item', playerId, passengerId });
  }

  interrupt(passengerId: string, at: SimTimeUs): RequestOutcome {
    this.requireNow(at);
    const action = this.requireWaiting(passengerId);
    const itemKind = kindOf(action);
    this.finish(passengerId, action, itemKind, 'interrupted', at);
    return this.emitted[this.emitted.length - 1] as RequestOutcome;
  }

  advanceTo(at: SimTimeUs): void {
    this.queue.advanceTo(
      at,
      () => undefined,
      (event) => this.apply(event),
    );
  }

  events(): readonly ActionRuntimeEvent[] {
    return [...this.emitted];
  }

  private apply(event: ScheduledEvent<TimelineEvent>): void {
    const payload = event.payload;
    switch (payload.kind) {
      case 'trait-expiry':
        this.entities.applyTraitExpiry(payload.key, event.generation);
        return;
      case 'request-timeout': {
        const action = this.matchAction(payload.passengerId, event.generation);
        if (action !== undefined) {
          this.finish(payload.passengerId, action, kindOf(action), 'timeout', event.at);
        }
        return;
      }
      case 'give-item':
        this.applyGive(payload.playerId, payload.passengerId, event.at);
        return;
      case 'resolve-request': {
        const action = this.matchAction(payload.passengerId, event.generation);
        if (action !== undefined && kindOf(action) === payload.itemKind) {
          this.finish(payload.passengerId, action, payload.itemKind, 'success', event.at);
        }
      }
    }
  }

  private applyGive(playerId: string, passengerId: string, at: SimTimeUs): void {
    let action: CurrentAction;
    try {
      action = this.requireGive(playerId, passengerId);
    } catch {
      this.emitted.push({ type: 'give-rejected', playerId, passengerId, at });
      return;
    }
    const itemKind = kindOf(action);
    const given = this.items.giveConsumable(playerId, passengerId);
    this.emitted.push(given);
    this.queue.schedule(
      at,
      { kind: 'resolve-request', passengerId, itemKind },
      actionKey(passengerId),
    );
  }

  private requireGive(playerId: string, passengerId: string): CurrentAction {
    const player = this.entities.get(playerId);
    const passenger = this.entities.get(passengerId);
    if (player.kind !== 'player' || passenger.kind !== 'passenger') {
      throw new RangeError('Give requires player and passenger');
    }
    const action = this.requireWaiting(passengerId);
    const itemKind = kindOf(action);
    if (!passenger.traits.includes(waitingTrait(itemKind))) {
      throw new RangeError('Passenger is not waiting for the item');
    }
    const held = this.items.snapshot().consumables.find((item) => item.id === player.heldItemId);
    if (held?.location !== 'held' || held.kind !== itemKind || held.holderId !== playerId) {
      throw new RangeError('Player does not hold the requested item');
    }
    if (
      player.position.kind !== 'cell' ||
      passenger.position.kind !== 'cell' ||
      player.position.cellId !== passenger.position.cellId
    ) {
      throw new RangeError('Player is not beside the passenger');
    }
    return action;
  }

  private requireWaiting(passengerId: string): CurrentAction {
    const passenger = this.entities.get(passengerId);
    const action = passenger.currentAction;
    if (passenger.kind !== 'passenger' || action?.phase.kind !== 'waiting') {
      throw new RangeError('Passenger has no waiting request');
    }
    kindOf(action);
    return action;
  }

  private matchAction(passengerId: string, generation: number | null): CurrentAction | undefined {
    const action = this.entities.get(passengerId).currentAction;
    if (action?.phase.kind !== 'waiting' || action.generation !== generation) return undefined;
    if (action.actionId !== 'request-food' && action.actionId !== 'request-drink') return undefined;
    return action;
  }

  private finish(
    passengerId: string,
    action: CurrentAction,
    itemKind: ConsumableKind,
    outcome: RequestOutcome['outcome'],
    at: SimTimeUs,
  ): void {
    const key = actionKey(passengerId);
    if (this.queue.generation(key) !== action.generation) {
      throw new RangeError('Request generation is stale');
    }
    const next = action.generation + 1;
    if (!Number.isSafeInteger(next)) throw new RangeError('Request generation is out of range');
    this.queue.setGeneration(key, next);
    this.entities.removeTrait(passengerId, waitingTrait(itemKind));
    if (outcome === 'success') {
      this.entities.removeTrait(passengerId, needTrait(itemKind));
      this.entities.grantTrait(passengerId, `has-${itemKind}`, at);
    } else if (outcome === 'timeout') {
      this.entities.grantTrait(passengerId, 'annoyed', at);
    }
    this.entities.clearCurrentAction(passengerId);
    this.emitted.push({ type: 'request-outcome', passengerId, itemKind, outcome, at });
  }

  private requireNow(at: SimTimeUs): void {
    if (assertSimTimeUs(at) !== this.queue.currentTime) {
      throw new RangeError('Advance simulation to the authoritative command time first');
    }
  }
}

function kindOf(action: CurrentAction): ConsumableKind {
  if (action.actionId === 'request-food') return 'food';
  if (action.actionId === 'request-drink') return 'drink';
  throw new RangeError('Action is not a food or drink request');
}
