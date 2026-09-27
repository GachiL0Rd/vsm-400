import {
  type EntitySelector,
  type EntityState,
  matchesEntitySelector,
  validateEntitySelector,
} from './entity-store';
import type { SimulationRandom } from './random';
import { assertSimTimeUs, type SimTimeUs } from './sim-time';

export const DECISION_HANDLERS = [
  'consume-item',
  'edit-document',
  'give-item',
  'inspect',
  'move',
  'open-close',
  'request-item',
  'submit-document',
  'use-object',
  'wait',
] as const;

export type DecisionHandler = (typeof DECISION_HANDLERS)[number];
export type TimeSource = 'traitAge' | 'routeTime' | 'timeOfDay' | 'serviceWindowTime';

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/** Serializable action asset. `params` is data, not code. */
export interface ActionDefinition {
  readonly id: string;
  readonly handler: string;
  readonly baseLogit: number;
  readonly params: { readonly [key: string]: JsonValue };
  readonly precondition?: EntitySelector;
  /** Public passenger line emitted when this action starts. Not a handler param. */
  readonly speech?: string;
}

export type ActionSelector =
  | { readonly op: 'id'; readonly id: string }
  | { readonly op: 'handler'; readonly handler: string }
  | { readonly op: 'not'; readonly selector: ActionSelector }
  | { readonly op: 'all'; readonly selectors: readonly ActionSelector[] }
  | { readonly op: 'any'; readonly selectors: readonly ActionSelector[] };

export type CurveDefinition =
  | { readonly kind: 'constant'; readonly value: number }
  | {
      readonly kind: 'linear';
      readonly origin: number;
      readonly slope: number;
      readonly time: TimeSource;
    }
  | {
      readonly kind: 'sigmoid';
      readonly origin: number;
      readonly height: number;
      readonly slope: number;
      readonly midpoint: number;
      readonly time: TimeSource;
    }
  | {
      readonly kind: 'window';
      readonly value: number;
      readonly start: number;
      readonly end: number;
      readonly time: TimeSource;
    };

export interface LogitModifierDefinition {
  readonly actionId: string;
  readonly curve: CurveDefinition;
}

/** Serializable trait asset. It does not copy onto the entity. */
export interface TraitDefinition {
  readonly id: string;
  readonly addActions?: readonly string[];
  readonly whitelistActions?: readonly ActionSelector[];
  readonly blacklistActions?: readonly ActionSelector[];
  readonly logitModifiers?: readonly LogitModifierDefinition[];
  readonly rejectIf?: readonly EntitySelector[];
  /** Public passenger line emitted when this trait is granted. */
  readonly speech?: string;
}

export interface ActionContent {
  readonly actions: readonly ActionDefinition[];
  readonly traits: readonly TraitDefinition[];
  readonly baseActions: {
    readonly player: readonly string[];
    readonly passenger: readonly string[];
  };
}

export interface DecisionContext {
  readonly now: SimTimeUs;
  readonly routeTime?: SimTimeUs;
  readonly timeOfDay?: SimTimeUs;
  readonly serviceWindowTime?: SimTimeUs;
  /** Private grant times supplied by the entity store. Missing means age zero. */
  readonly traitGrantedAt?: Readonly<Record<string, SimTimeUs>>;
  readonly environmentActionIds?: readonly string[];
  readonly blockedActionIds?: readonly string[];
  readonly contextModifiers?: readonly LogitModifierDefinition[];
}

export interface ScoredCandidate {
  readonly actionId: string;
  readonly logit: number;
  readonly probability: number;
}

export interface EvaluatedCandidates {
  readonly fallback: boolean;
  readonly candidates: readonly ScoredCandidate[];
}

export type NpcDecision =
  | { readonly status: 'busy' }
  | {
      readonly status: 'chosen';
      readonly actionId: string;
      readonly logit: number;
      readonly probability: number;
      readonly candidates: readonly ScoredCandidate[];
    };

export interface ActionCatalog {
  definition(actionId: string): ActionDefinition;
  actionSpeech(actionId: string): string | undefined;
  traitSpeech(traitId: string): string | undefined;
  evaluate(entity: EntityState, context: DecisionContext): EvaluatedCandidates;
  chooseNpcAction(
    random: SimulationRandom,
    entity: EntityState,
    context: DecisionContext,
  ): NpcDecision;
}

const FALLBACK_ACTION_ID = 'wait';
const TIME_SOURCES = new Set<TimeSource>([
  'traitAge',
  'routeTime',
  'timeOfDay',
  'serviceWindowTime',
]);

export function decisionStreamKey(entityId: string): string {
  return `npc:${entityId}:decision`;
}

export function loadActionContent(content: ActionContent): ActionCatalog {
  const actions = new Map<string, ActionDefinition>();
  for (const action of content.actions) {
    const id = assertId(action.id, 'Action id');
    if (actions.has(id)) throw new RangeError(`Duplicate action id ${id}`);
    if (!isHandler(action.handler)) {
      throw new RangeError(`Unknown action handler ${action.handler}`);
    }
    assertFinite(action.baseLogit, 'Base logit');
    assertJsonObject(action.params, `${id} params`);
    assertOptionalSpeech(action.speech, `Action ${id}`);
    if (action.precondition !== undefined) validateEntitySelector(action.precondition);
    actions.set(id, { ...action, id });
  }
  if (actions.get(FALLBACK_ACTION_ID)?.handler !== 'wait') {
    throw new RangeError('Content requires a wait action with handler wait');
  }

  const traits = new Map<string, TraitDefinition>();
  for (const trait of content.traits) {
    const id = assertId(trait.id, 'Trait id');
    if (traits.has(id)) throw new RangeError(`Duplicate trait id ${id}`);
    validateTrait(trait, actions);
    traits.set(id, trait);
  }
  validateBaseList(content.baseActions.player, actions, 'Player base action');
  validateBaseList(content.baseActions.passenger, actions, 'Passenger base action');

  return new Catalog(actions, traits, {
    player: [...content.baseActions.player],
    passenger: [...content.baseActions.passenger],
  });
}

class Catalog implements ActionCatalog {
  constructor(
    private readonly actions: ReadonlyMap<string, ActionDefinition>,
    private readonly traits: ReadonlyMap<string, TraitDefinition>,
    private readonly baseActions: {
      readonly player: readonly string[];
      readonly passenger: readonly string[];
    },
  ) {}

  definition(actionId: string): ActionDefinition {
    const action = this.requireAction(actionId);
    return {
      ...action,
      params: { ...action.params },
    };
  }

  actionSpeech(actionId: string): string | undefined {
    return this.actions.get(actionId)?.speech;
  }

  traitSpeech(traitId: string): string | undefined {
    return this.traits.get(traitId)?.speech;
  }

  evaluate(entity: EntityState, context: DecisionContext): EvaluatedCandidates {
    const now = assertSimTimeUs(context.now);
    const selected = this.filter(entity, context);
    const fallback = selected.length === 0;
    const ids = fallback ? [FALLBACK_ACTION_ID] : selected;
    const modifiers = this.modifiers(entity, context);
    const logits = ids.map((id) => {
      const action = this.actions.get(id);
      const base = action?.baseLogit ?? 0;
      return base + modifierSum(modifiers, id, entity, context, now);
    });
    const probabilities = stableSoftmax(logits);
    return {
      fallback,
      candidates: ids.map((actionId, index) => ({
        actionId,
        logit: logits[index] ?? 0,
        probability: probabilities[index] ?? 0,
      })),
    };
  }

  chooseNpcAction(
    random: SimulationRandom,
    entity: EntityState,
    context: DecisionContext,
  ): NpcDecision {
    if (entity.kind !== 'passenger') {
      throw new RangeError('Only a passenger is chosen by the decision engine');
    }
    if (entity.currentAction !== undefined) return { status: 'busy' };
    const evaluated = this.evaluate(entity, context);
    const stream = random.stream(decisionStreamKey(entity.id));
    const chosen = pickCandidate(evaluated.candidates, stream.nextUnit());
    return {
      status: 'chosen',
      actionId: chosen.actionId,
      logit: chosen.logit,
      probability: chosen.probability,
      candidates: evaluated.candidates,
    };
  }

  private filter(entity: EntityState, context: DecisionContext): string[] {
    const ids = new Set<string>();
    const base = entity.kind === 'player' ? this.baseActions.player : this.baseActions.passenger;
    for (const id of base) ids.add(this.requireAction(id).id);
    for (const traitId of [...entity.traits].sort(compareIds)) {
      const trait = this.requireTrait(traitId);
      for (const actionId of trait.addActions ?? []) ids.add(this.requireAction(actionId).id);
    }
    for (const actionId of context.environmentActionIds ?? []) {
      ids.add(this.requireAction(actionId).id);
    }

    const blocked = new Set(context.blockedActionIds ?? []);
    // Selectors inside one whitelist are alternatives. Traits then intersect.
    const whitelists = [...entity.traits]
      .sort(compareIds)
      .map((traitId) => this.requireTrait(traitId).whitelistActions)
      .filter((list): list is readonly ActionSelector[] => list !== undefined);
    const blacklists = [...entity.traits]
      .sort(compareIds)
      .flatMap((traitId) => this.requireTrait(traitId).blacklistActions ?? []);

    return [...ids]
      .filter((id) => this.keeps(id, entity, blocked, whitelists, blacklists))
      .sort(compareIds);
  }

  private keeps(
    id: string,
    entity: EntityState,
    blocked: ReadonlySet<string>,
    whitelists: readonly (readonly ActionSelector[])[],
    blacklists: readonly ActionSelector[],
  ): boolean {
    const action = this.requireAction(id);
    if (action.precondition !== undefined && !matchesEntitySelector(entity, action.precondition)) {
      return false;
    }
    if (blocked.has(id)) return false;
    for (const whitelist of whitelists) {
      if (!whitelist.some((selector) => actionMatches(action, selector))) return false;
    }
    return !blacklists.some((selector) => actionMatches(action, selector));
  }

  private modifiers(entity: EntityState, context: DecisionContext): readonly ModifierUse[] {
    const uses: ModifierUse[] = [];
    for (const traitId of [...entity.traits].sort(compareIds)) {
      for (const modifier of this.requireTrait(traitId).logitModifiers ?? []) {
        uses.push({ modifier, traitId });
      }
    }
    for (const modifier of context.contextModifiers ?? []) {
      this.requireAction(modifier.actionId);
      validateCurve(modifier.curve);
      uses.push({ modifier, traitId: null });
    }
    return uses;
  }

  private requireAction(id: string): ActionDefinition {
    const action = this.actions.get(id);
    if (action === undefined) throw new RangeError(`Unknown action ${id}`);
    return action;
  }

  private requireTrait(id: string): TraitDefinition {
    const trait = this.traits.get(id);
    if (trait === undefined) throw new RangeError(`Unknown trait ${id}`);
    return trait;
  }
}

interface ModifierUse {
  readonly modifier: LogitModifierDefinition;
  readonly traitId: string | null;
}

function modifierSum(
  uses: readonly ModifierUse[],
  actionId: string,
  entity: EntityState,
  context: DecisionContext,
  now: SimTimeUs,
): number {
  let sum = 0;
  for (const use of uses) {
    if (use.modifier.actionId !== actionId) continue;
    sum += evaluateCurve(
      use.modifier.curve,
      timeOf(use.modifier.curve, use.traitId, entity, context, now),
    );
  }
  return sum;
}

function timeOf(
  curve: CurveDefinition,
  traitId: string | null,
  entity: EntityState,
  context: DecisionContext,
  now: SimTimeUs,
): SimTimeUs {
  if (curve.kind === 'constant') return 0;
  const source = curve.time;
  if (source === 'traitAge') {
    if (traitId === null || !entity.traits.includes(traitId)) {
      throw new RangeError('Trait age requires the trait that owns the modifier');
    }
    const grantedAt = context.traitGrantedAt?.[traitId] ?? 0;
    if (grantedAt > now) throw new RangeError('Trait grant time is after the decision time');
    return now - grantedAt;
  }
  const value = context[source];
  if (value === undefined) throw new RangeError(`Decision context is missing ${source}`);
  return assertSimTimeUs(value);
}

function evaluateCurve(curve: CurveDefinition, time: number): number {
  switch (curve.kind) {
    case 'constant':
      return curve.value;
    case 'linear':
      return curve.origin + curve.slope * time;
    case 'sigmoid': {
      const exponent = Math.max(-700, Math.min(700, curve.slope * (time - curve.midpoint)));
      return curve.origin + curve.height / (1 + Math.exp(-exponent));
    }
    case 'window':
      return time >= curve.start && time < curve.end ? curve.value : 0;
    default:
      return 0;
  }
}

function stableSoftmax(logits: readonly number[]): number[] {
  if (logits.length === 0) return [];
  let maxLogit = Number.NEGATIVE_INFINITY;
  for (const logit of logits) {
    if (!Number.isFinite(logit)) throw new RangeError('Action logit must be finite');
    if (logit > maxLogit) maxLogit = logit;
  }
  const weights = logits.map((logit) => Math.exp(logit - maxLogit));
  let sum = 0;
  for (const weight of weights) sum += weight;
  if (!(sum > 0) || !Number.isFinite(sum)) return logits.map(() => 1 / logits.length);
  return weights.map((weight) => weight / sum);
}

function pickCandidate(candidates: readonly ScoredCandidate[], draw: number): ScoredCandidate {
  const last = candidates[candidates.length - 1];
  if (last === undefined) throw new RangeError('Decision has no fallback action');
  let cumulative = 0;
  for (const candidate of candidates) {
    cumulative += candidate.probability;
    if (draw < cumulative) return candidate;
  }
  return last;
}

function validateTrait(
  trait: TraitDefinition,
  actions: ReadonlyMap<string, ActionDefinition>,
): void {
  assertOptionalSpeech(trait.speech, `Trait ${trait.id}`);
  validateAddedActions(trait, actions);
  validateTraitActionSelectors(trait, actions);
  validateTraitWhitelist(trait);
  validateTraitModifiers(trait, actions);
  for (const selector of trait.rejectIf ?? []) validateEntitySelector(selector);
}

function validateAddedActions(
  trait: TraitDefinition,
  actions: ReadonlyMap<string, ActionDefinition>,
): void {
  const added = new Set<string>();
  for (const actionId of trait.addActions ?? []) {
    if (added.has(actionId)) throw new RangeError(`Trait ${trait.id} lists ${actionId} twice`);
    added.add(actionId);
    if (!actions.has(actionId)) {
      throw new RangeError(`Trait ${trait.id} references unknown action ${actionId}`);
    }
  }
}

function validateTraitActionSelectors(
  trait: TraitDefinition,
  actions: ReadonlyMap<string, ActionDefinition>,
): void {
  for (const selector of trait.whitelistActions ?? []) validateActionSelector(selector, actions);
  for (const selector of trait.blacklistActions ?? []) validateActionSelector(selector, actions);
}

function validateTraitWhitelist(trait: TraitDefinition): void {
  const whitelist = trait.whitelistActions ?? [];
  const blacklistIds = new Set(
    (trait.blacklistActions ?? [])
      .filter((selector) => selector.op === 'id')
      .map((selector) => selector.id),
  );
  if (
    whitelist.length > 0 &&
    whitelist.every((selector) => selector.op === 'id' && blacklistIds.has(selector.id))
  ) {
    throw new RangeError(`Trait ${trait.id} blocks its entire whitelist`);
  }
}

function validateTraitModifiers(
  trait: TraitDefinition,
  actions: ReadonlyMap<string, ActionDefinition>,
): void {
  for (const modifier of trait.logitModifiers ?? []) {
    if (!actions.has(modifier.actionId)) {
      throw new RangeError(`Trait ${trait.id} modifies unknown action ${modifier.actionId}`);
    }
    validateCurve(modifier.curve);
  }
}

function validateActionSelector(
  selector: ActionSelector,
  actions: ReadonlyMap<string, ActionDefinition>,
): void {
  switch (selector.op) {
    case 'id':
      assertId(selector.id, 'Action selector id');
      if (!actions.has(selector.id)) throw new RangeError(`Unknown action ${selector.id}`);
      return;
    case 'handler':
      if (!isHandler(selector.handler))
        throw new RangeError(`Unknown action handler ${selector.handler}`);
      return;
    case 'not':
      validateActionSelector(selector.selector, actions);
      return;
    case 'all':
    case 'any':
      if (!Array.isArray(selector.selectors))
        throw new RangeError('Action selector list is invalid');
      for (const item of selector.selectors) validateActionSelector(item, actions);
      return;
    default:
      throw new RangeError('Action selector is invalid');
  }
}

function actionMatches(action: ActionDefinition, selector: ActionSelector): boolean {
  switch (selector.op) {
    case 'id':
      return action.id === selector.id;
    case 'handler':
      return action.handler === selector.handler;
    case 'not':
      return !actionMatches(action, selector.selector);
    case 'all':
      return selector.selectors.every((item) => actionMatches(action, item));
    case 'any':
      return selector.selectors.some((item) => actionMatches(action, item));
    default:
      return false;
  }
}

function validateCurve(curve: CurveDefinition): void {
  switch (curve.kind) {
    case 'constant':
      assertFinite(curve.value, 'Curve value');
      return;
    case 'linear':
      assertFinite(curve.origin, 'Curve origin');
      assertFinite(curve.slope, 'Curve slope');
      assertTimeSource(curve.time);
      return;
    case 'sigmoid':
      assertFinite(curve.origin, 'Curve origin');
      assertFinite(curve.height, 'Curve height');
      assertFinite(curve.slope, 'Curve slope');
      assertFinite(curve.midpoint, 'Curve midpoint');
      assertTimeSource(curve.time);
      return;
    case 'window':
      assertFinite(curve.value, 'Curve value');
      assertFinite(curve.start, 'Curve start');
      assertFinite(curve.end, 'Curve end');
      if (!(curve.start < curve.end)) throw new RangeError('Curve window must have start < end');
      assertTimeSource(curve.time);
      return;
    default:
      throw new RangeError('Curve is invalid');
  }
}

function validateBaseList(
  ids: readonly string[],
  actions: ReadonlyMap<string, ActionDefinition>,
  label: string,
): void {
  if (!Array.isArray(ids)) throw new RangeError(`${label} list is invalid`);
  for (const id of ids) {
    if (!actions.has(id)) throw new RangeError(`${label} ${id} is unknown`);
  }
}

function assertTimeSource(time: TimeSource): void {
  if (!TIME_SOURCES.has(time)) throw new RangeError('Curve time source is invalid');
}

function assertJsonObject(value: unknown, label: string): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new RangeError(`${label} must be a JSON object`);
  }
  for (const [key, entry] of Object.entries(value)) assertJson(entry, `${label}.${key}`);
}

function assertJson(value: unknown, label: string): void {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return;
  if (typeof value === 'number') {
    assertFinite(value, label);
    return;
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      assertJson(value[index], `${label}[${index}]`);
    }
    return;
  }
  if (typeof value === 'object') {
    assertJsonObject(value, label);
    return;
  }
  throw new RangeError(`${label} is not JSON data`);
}

function isHandler(handler: string): handler is DecisionHandler {
  return (DECISION_HANDLERS as readonly string[]).includes(handler);
}

function assertOptionalSpeech(value: string | undefined, label: string): void {
  if (value === undefined) return;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new RangeError(`${label} speech must be a non-empty string`);
  }
}

function assertId(value: string, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new RangeError(`${label} must be a non-empty string`);
  }
  return value;
}

function assertFinite(value: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RangeError(`${label} must be a finite number`);
  }
  return value;
}

function compareIds(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
