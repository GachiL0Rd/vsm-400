import type {
  ActionCatalog,
  ActionDefinition,
  DecisionContext,
  JsonValue,
} from './action-decision';
import type { CurrentAction, EntityId, EntityState, EntityStore, TraitId } from './entity-store';
import { assertSimTimeUs, type SimTimeUs, secondsToSimTimeUs } from './sim-time';

export type ActionOutcome = 'success' | 'timeout' | 'interrupted';

export interface ActionExternalEvent {
  readonly type: string;
}

export interface ActionResolution {
  readonly result?: JsonValue;
}

export type ActionStart =
  | { readonly kind: 'instant' }
  | { readonly kind: 'running'; readonly completesAt: SimTimeUs }
  | { readonly kind: 'waiting'; readonly timeoutAt?: SimTimeUs };

export type ActionRuntimeEvent =
  | {
      readonly kind: 'complete';
      readonly entityId: EntityId;
      readonly generation: number;
    }
  | {
      readonly kind: 'timeout';
      readonly entityId: EntityId;
      readonly generation: number;
    }
  | {
      readonly kind: 'resolve';
      readonly entityId: EntityId;
      readonly generation: number;
      readonly outcome: 'success' | 'interrupted';
      readonly result?: JsonValue;
    };

export interface ActionRuntimeScheduler {
  schedule(at: SimTimeUs, event: ActionRuntimeEvent, generationKey: string): void;
  generation(key: string): number;
  setGeneration(key: string, generation: number): void;
}

export interface ActionHandlerContext {
  readonly now: SimTimeUs;
  readonly actor: EntityState;
  readonly targetId?: string;
  readonly definition: ActionDefinition;
  readonly entities: EntityStore;
}

export interface ActionHandler {
  canStart?(context: ActionHandlerContext): void;
  start(context: ActionHandlerContext): ActionStart;
  matchEvent?(
    context: ActionHandlerContext & { readonly currentAction: CurrentAction },
    event: ActionExternalEvent,
  ): ActionResolution | null;
  finish?(
    context: ActionHandlerContext & { readonly currentAction: CurrentAction },
    outcome: ActionOutcome,
    result?: JsonValue,
  ): void;
}

export interface StartActionInput {
  readonly actorId: EntityId;
  readonly actionId: string;
  readonly now: SimTimeUs;
  readonly decisionContext: DecisionContext;
  readonly targetId?: string;
}

export type StartActionResult =
  | { readonly status: 'finished'; readonly outcome: 'success' }
  | { readonly status: 'started'; readonly action: CurrentAction };

export interface AppliedActionResult {
  readonly status: 'ignored' | 'finished';
  readonly entityId: EntityId;
  readonly outcome?: ActionOutcome;
}

export interface ActionRuntime {
  start(input: StartActionInput): StartActionResult;
  apply(event: ActionRuntimeEvent, now: SimTimeUs): AppliedActionResult;
  handleExternalEvent(event: ActionExternalEvent, now: SimTimeUs): number;
  interrupt(entityId: EntityId, now: SimTimeUs): boolean;
}

export interface ActionRuntimeOptions {
  readonly catalog: ActionCatalog;
  readonly entities: EntityStore;
  readonly scheduler: ActionRuntimeScheduler;
  readonly handlers: Readonly<Record<string, ActionHandler>>;
}

export function actionGenerationKey(entityId: EntityId): string {
  return `action/${encodeId(entityId)}`;
}

export function createActionRuntime(options: ActionRuntimeOptions): ActionRuntime {
  return new Runtime(options.catalog, options.entities, options.scheduler, options.handlers);
}

class Runtime implements ActionRuntime {
  constructor(
    private readonly catalog: ActionCatalog,
    private readonly entities: EntityStore,
    private readonly scheduler: ActionRuntimeScheduler,
    private readonly handlers: Readonly<Record<string, ActionHandler>>,
  ) {}

  start(input: StartActionInput): StartActionResult {
    const now = assertSimTimeUs(input.now);
    const actor = this.entities.get(input.actorId);
    if (actor.currentAction !== undefined)
      throw new RangeError('Entity already has a current action');

    const definition = this.catalog.definition(input.actionId);
    const available = this.catalog
      .evaluate(actor, { ...input.decisionContext, now })
      .candidates.some((candidate) => candidate.actionId === definition.id);
    if (!available) throw new RangeError(`Action ${definition.id} is not currently available`);

    const handler = this.requireHandler(definition.handler);
    const context = actionContext(now, actor, definition, this.entities, input.targetId);
    handler.canStart?.(context);
    const start = validateStart(handler.start(context), now);

    if (start.kind === 'instant') {
      handler.finish?.(
        {
          ...context,
          currentAction: syntheticInstantAction(definition.id, now, input.targetId),
        },
        'success',
      );
      return { status: 'finished', outcome: 'success' };
    }

    const key = actionGenerationKey(actor.id);
    const generation = this.bumpGeneration(key);
    const action: CurrentAction = {
      actionId: definition.id,
      generation,
      startedAt: now,
      ...(input.targetId === undefined ? {} : { targetId: input.targetId }),
      phase:
        start.kind === 'running'
          ? { kind: 'running', completesAt: start.completesAt }
          : start.timeoutAt === undefined
            ? { kind: 'waiting' }
            : { kind: 'waiting', timeoutAt: start.timeoutAt },
    };
    this.entities.setCurrentAction(actor.id, action);

    if (start.kind === 'running') {
      this.scheduler.schedule(
        start.completesAt,
        { kind: 'complete', entityId: actor.id, generation },
        key,
      );
    } else if (start.timeoutAt !== undefined) {
      this.scheduler.schedule(
        start.timeoutAt,
        { kind: 'timeout', entityId: actor.id, generation },
        key,
      );
    }

    return {
      status: 'started',
      action: this.entities.get(actor.id).currentAction as CurrentAction,
    };
  }

  apply(event: ActionRuntimeEvent, now: SimTimeUs): AppliedActionResult {
    const at = assertSimTimeUs(now);
    const actor = this.entities.get(event.entityId);
    const current = actor.currentAction;
    if (current === undefined || current.generation !== event.generation) {
      return { status: 'ignored', entityId: actor.id };
    }

    const outcome = outcomeOf(event, current);
    if (outcome === null) return { status: 'ignored', entityId: actor.id };

    const definition = this.catalog.definition(current.actionId);
    const handler = this.requireHandler(definition.handler);
    handler.finish?.(
      {
        ...actionContext(at, actor, definition, this.entities, current.targetId),
        currentAction: current,
      },
      outcome,
      event.kind === 'resolve' ? event.result : undefined,
    );

    this.entities.clearCurrentAction(actor.id);
    this.bumpGeneration(actionGenerationKey(actor.id));
    return { status: 'finished', entityId: actor.id, outcome };
  }

  handleExternalEvent(event: ActionExternalEvent, now: SimTimeUs): number {
    const at = assertSimTimeUs(now);
    let scheduled = 0;
    for (const actor of this.entities.list()) {
      const current = actor.currentAction;
      if (current === undefined || current.phase.kind !== 'waiting') continue;
      const definition = this.catalog.definition(current.actionId);
      const handler = this.requireHandler(definition.handler);
      if (handler.matchEvent === undefined) continue;
      const resolution = handler.matchEvent(
        {
          ...actionContext(at, actor, definition, this.entities, current.targetId),
          currentAction: current,
        },
        event,
      );
      if (resolution === null) continue;
      this.scheduler.schedule(
        at,
        {
          kind: 'resolve',
          entityId: actor.id,
          generation: current.generation,
          outcome: 'success',
          ...(resolution.result === undefined ? {} : { result: resolution.result }),
        },
        actionGenerationKey(actor.id),
      );
      scheduled += 1;
    }
    return scheduled;
  }

  interrupt(entityId: EntityId, now: SimTimeUs): boolean {
    const actor = this.entities.get(entityId);
    const current = actor.currentAction;
    if (current === undefined) return false;
    const at = assertSimTimeUs(now);
    this.scheduler.schedule(
      at,
      {
        kind: 'resolve',
        entityId: actor.id,
        generation: current.generation,
        outcome: 'interrupted',
      },
      actionGenerationKey(actor.id),
    );
    return true;
  }

  private requireHandler(id: string): ActionHandler {
    const handler = this.handlers[id];
    if (handler === undefined) throw new RangeError(`Action handler ${id} is not registered`);
    return handler;
  }

  private bumpGeneration(key: string): number {
    const next = this.scheduler.generation(key) + 1;
    if (!Number.isSafeInteger(next)) {
      throw new RangeError('Action generation exceeded the safe integer range');
    }
    this.scheduler.setGeneration(key, next);
    return next;
  }
}

export function createWaitActionHandler(defaultSeconds = 1): ActionHandler {
  const defaultDuration = secondsToSimTimeUs(defaultSeconds);
  return {
    start(context) {
      const duration = optionalDurationSeconds(
        context.definition.params.durationSeconds,
        defaultDuration,
      );
      return { kind: 'running', completesAt: addTime(context.now, duration) };
    },
  };
}

export function createRequestItemActionHandler(): ActionHandler {
  return {
    canStart(context) {
      const params = requestItemParams(context.definition);
      if (context.actor.kind !== 'passenger') {
        throw new RangeError('Only passengers can request service items');
      }
      if (context.actor.traits.includes(params.waitingTrait)) {
        throw new RangeError(`Passenger already has trait ${params.waitingTrait}`);
      }
    },
    start(context) {
      const params = requestItemParams(context.definition);
      context.entities.grantTrait(context.actor.id, params.waitingTrait, context.now);
      if (params.timeoutSeconds === undefined) return { kind: 'waiting' };
      return {
        kind: 'waiting',
        timeoutAt: addTime(context.now, secondsToSimTimeUs(params.timeoutSeconds)),
      };
    },
    matchEvent(context, event) {
      const params = requestItemParams(context.definition);
      if (event.type !== 'item-given') return null;
      const itemEvent = event as ActionExternalEvent & {
        readonly targetId?: unknown;
        readonly itemKind?: unknown;
      };
      if (itemEvent.targetId !== context.actor.id || itemEvent.itemKind !== params.itemKind) {
        return null;
      }
      return {};
    },
    finish(context, outcome) {
      const params = requestItemParams(context.definition);
      context.entities.removeTrait(context.actor.id, params.waitingTrait);
      if (outcome === 'success' && params.receivedTrait !== undefined) {
        context.entities.grantTrait(context.actor.id, params.receivedTrait, context.now);
      }
      if (outcome === 'timeout' && params.timeoutTrait !== undefined) {
        context.entities.grantTrait(context.actor.id, params.timeoutTrait, context.now);
      }
    },
  };
}

export function createConsumeTraitActionHandler(): ActionHandler {
  return {
    canStart(context) {
      const params = consumeTraitParams(context.definition);
      if (!context.actor.traits.includes(params.consumeTrait)) {
        throw new RangeError(`Entity does not have trait ${params.consumeTrait}`);
      }
    },
    start(context) {
      const params = consumeTraitParams(context.definition);
      const duration = secondsToSimTimeUs(params.durationSeconds ?? 1);
      return { kind: 'running', completesAt: addTime(context.now, duration) };
    },
    finish(context, outcome) {
      if (outcome !== 'success') return;
      const params = consumeTraitParams(context.definition);
      context.entities.removeTrait(context.actor.id, params.consumeTrait);
      if (params.satisfyTrait !== undefined && context.actor.traits.includes(params.satisfyTrait)) {
        context.entities.removeTrait(context.actor.id, params.satisfyTrait);
      }
    },
  };
}

interface ConsumeTraitParams {
  readonly consumeTrait: TraitId;
  readonly satisfyTrait?: TraitId;
  readonly durationSeconds?: number;
}

function consumeTraitParams(definition: ActionDefinition): ConsumeTraitParams {
  const consumeTrait = requiredString(
    definition.params.consumeTrait,
    `${definition.id}.params.consumeTrait`,
  );
  const satisfyTrait = optionalString(
    definition.params.satisfyTrait,
    `${definition.id}.params.satisfyTrait`,
  );
  const durationSeconds = optionalNonnegativeNumber(
    definition.params.durationSeconds,
    `${definition.id}.params.durationSeconds`,
  );
  return {
    consumeTrait,
    ...(satisfyTrait === undefined ? {} : { satisfyTrait }),
    ...(durationSeconds === undefined ? {} : { durationSeconds }),
  };
}

interface RequestItemParams {
  readonly itemKind: string;
  readonly waitingTrait: TraitId;
  readonly timeoutSeconds?: number;
  readonly receivedTrait?: TraitId;
  readonly timeoutTrait?: TraitId;
}

function requestItemParams(definition: ActionDefinition): RequestItemParams {
  const { params } = definition;
  const itemKind = requiredString(params.itemKind, `${definition.id}.params.itemKind`);
  const waitingTrait = requiredString(params.waitingTrait, `${definition.id}.params.waitingTrait`);
  const timeoutSeconds = optionalNonnegativeNumber(
    params.timeoutSeconds,
    `${definition.id}.params.timeoutSeconds`,
  );
  const receivedTrait = optionalString(
    params.receivedTrait,
    `${definition.id}.params.receivedTrait`,
  );
  const timeoutTrait = optionalString(params.timeoutTrait, `${definition.id}.params.timeoutTrait`);
  return {
    itemKind,
    waitingTrait,
    ...(timeoutSeconds === undefined ? {} : { timeoutSeconds }),
    ...(receivedTrait === undefined ? {} : { receivedTrait }),
    ...(timeoutTrait === undefined ? {} : { timeoutTrait }),
  };
}

function actionContext(
  now: SimTimeUs,
  actor: EntityState,
  definition: ActionDefinition,
  entities: EntityStore,
  targetId: string | undefined,
): ActionHandlerContext {
  return targetId === undefined
    ? { now, actor, definition, entities }
    : { now, actor, targetId, definition, entities };
}

function syntheticInstantAction(
  actionId: string,
  now: SimTimeUs,
  targetId: string | undefined,
): CurrentAction {
  return {
    actionId,
    generation: 0,
    startedAt: now,
    ...(targetId === undefined ? {} : { targetId }),
    phase: { kind: 'running', completesAt: now },
  };
}

function outcomeOf(event: ActionRuntimeEvent, current: CurrentAction): ActionOutcome | null {
  if (event.kind === 'complete') {
    return current.phase.kind === 'running' ? 'success' : null;
  }
  if (event.kind === 'timeout') {
    return current.phase.kind === 'waiting' ? 'timeout' : null;
  }
  if (event.outcome === 'interrupted') return 'interrupted';
  return current.phase.kind === 'waiting' ? 'success' : null;
}

function validateStart(start: ActionStart, now: SimTimeUs): ActionStart {
  if (start.kind === 'instant') return start;
  if (start.kind === 'running') {
    const completesAt = assertSimTimeUs(start.completesAt);
    if (completesAt < now) throw new RangeError('Running action cannot complete before it starts');
    return { kind: 'running', completesAt };
  }
  if (start.kind === 'waiting') {
    if (start.timeoutAt === undefined) return { kind: 'waiting' };
    const timeoutAt = assertSimTimeUs(start.timeoutAt);
    if (timeoutAt < now) throw new RangeError('Waiting action cannot time out before it starts');
    return { kind: 'waiting', timeoutAt };
  }
  throw new RangeError('Action start is invalid');
}

function requiredString(value: JsonValue | undefined, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new RangeError(`${label} is required`);
  return value;
}

function optionalString(value: JsonValue | undefined, label: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, label);
}

function optionalNonnegativeNumber(
  value: JsonValue | undefined,
  label: string,
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a finite nonnegative number`);
  }
  return value;
}

function optionalDurationSeconds(value: JsonValue | undefined, fallback: SimTimeUs): SimTimeUs {
  if (value === undefined) return fallback;
  const seconds = optionalNonnegativeNumber(value, 'durationSeconds');
  return secondsToSimTimeUs(seconds ?? 0);
}

function addTime(left: SimTimeUs, right: SimTimeUs): SimTimeUs {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new RangeError('Simulation time overflow');
  return assertSimTimeUs(result);
}

function encodeId(id: string): string {
  return `${id.length}:${id}`;
}
