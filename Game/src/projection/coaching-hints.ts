import type {
  PresentationEventPayload,
  PublicTargetRef,
  SessionModeView,
} from '../common/game-wire';
import type { GameAttempt, GameAttemptSnapshot } from '../simulation/game-attempt';
import { acceptanceJournalIsComplete } from '../simulation/item-store';
import type { SimTimeUs } from '../simulation/sim-time';
import type { HintContent, HintDefinition, HintObjectTarget, HintTrigger } from './hint-content';

type HintPolicy = Extract<SessionModeView, { kind: 'guided' }>['hints'];

type Emit = (at: SimTimeUs, event: PresentationEventPayload) => void;

interface RequestWatch {
  key: string;
  startedAt: SimTimeUs;
  hinted: boolean;
}

const OBJECTIVE_LADDER = ['journal-taken', 'journal-filled', 'meet-passengers'] as const;

type ObjectiveTrigger = HintTrigger;

/**
 * Guided coaching. Reads authoritative progress and queues transient hint
 * events. It does not write simulation, seed, or assessment state.
 *
 * Within one capture, after speech and before phase notices: objective
 * suggestions, immediate-feedback toasts, passenger-attention toasts, then
 * inactivity repeats. `at` is the sim time the condition became true.
 */
export class CoachingObserver {
  private readonly active: boolean;
  private readonly policy: HintPolicy | undefined;
  private readonly byTrigger = new Map<HintTrigger, HintDefinition>();
  private readonly emitted = new Set<string>();
  private readonly requests = new Map<string, RequestWatch>();
  private readonly decisions = new Map<string, string>();
  private nextInactivityAt: SimTimeUs;
  private inPreDeparture = true;
  private terminalRead = false;

  constructor(
    private readonly attempt: GameAttempt,
    mode: SessionModeView,
    hints: HintContent | undefined,
    private readonly emit: Emit,
  ) {
    this.active = mode.kind === 'guided' && hints !== undefined;
    this.policy = mode.kind === 'guided' ? mode.hints : undefined;
    const inactivity = hints?.hints.find((hint) => hint.trigger === 'inactivity');
    this.nextInactivityAt = inactivity?.afterUs ?? Number.POSITIVE_INFINITY;
    if (hints === undefined) return;
    for (const hint of hints.hints) this.byTrigger.set(hint.trigger, hint);
  }

  clock(): SimTimeUs {
    return this.nextInactivityAt;
  }

  restore(nextAt: SimTimeUs): void {
    this.nextInactivityAt = nextAt;
  }

  /** A recorded gameplay command resets the pre-departure idle window. */
  notePlayerCommand(at: SimTimeUs): void {
    if (!this.active) return;
    const interval = this.byTrigger.get('inactivity')?.afterUs;
    if (interval === undefined) return;
    this.nextInactivityAt = at + interval;
  }

  capture(snapshot: GameAttemptSnapshot): void {
    if (!this.active || this.policy === undefined) return;
    this.emitObjectives(snapshot);
    this.captureBoarding(snapshot);
    this.captureTerminal(snapshot);
    this.captureRequests(snapshot);
    this.captureInactivity(snapshot);
  }

  private emitObjectives(snapshot: GameAttemptSnapshot): void {
    if (!this.policy?.suggestions) return;
    const start = this.byTrigger.get('attempt-start');
    if (start !== undefined && !this.emitted.has(start.id)) {
      this.emitDefined(start, 0, start.target);
    }
    if (snapshot.termination !== null) return;
    const current = objectiveTrigger(snapshot);
    if (current === 'attempt-start') return;
    for (const trigger of OBJECTIVE_LADDER) {
      const hint = this.byTrigger.get(trigger);
      if (hint !== undefined && !this.emitted.has(hint.id)) {
        this.emitDefined(hint, snapshot.time, hint.target);
        if (trigger === 'journal-taken') this.emitHighlights(hint, snapshot.time);
      }
      if (trigger === current) break;
    }
  }

  private emitHighlights(hint: HintDefinition, at: SimTimeUs): void {
    if (!this.policy?.objectHighlights) return;
    for (const highlight of hint.highlights ?? []) {
      if (this.emitted.has(highlight.id)) continue;
      this.emitted.add(highlight.id);
      this.emit(
        at,
        hintPayload(highlight.id, 'highlight', undefined, {
          kind: 'object',
          objectId: highlight.objectId,
        }),
      );
    }
  }

  private captureBoarding(snapshot: GameAttemptSnapshot): void {
    for (const row of snapshot.boardingDecisions) {
      const previous = this.decisions.get(row.passengerId) ?? 'pending';
      if (row.decision === previous) continue;
      this.decisions.set(row.passengerId, row.decision);
      if (row.decision === 'pending') continue;
      const expected = this.attempt.scenario.passenger(row.passengerId).expectedBoardingDecision;
      if (row.decision === expected) continue;
      const trigger = row.decision === 'admit' ? 'feedback-unsafe-admit' : 'feedback-wrong-reject';
      this.emitFeedback(trigger, snapshot.time, { kind: 'entity', entityId: row.passengerId });
    }
  }

  private captureTerminal(snapshot: GameAttemptSnapshot): void {
    if (!this.policy?.immediateFeedback || snapshot.termination === null || this.terminalRead) {
      return;
    }
    this.terminalRead = true;
    const facts = this.attempt.assessmentResult().facts;
    if (
      facts.some((fact) => fact.kind === 'journal-submission' && fact.detail.falseReport === true)
    ) {
      this.emitFeedback('feedback-false-journal', snapshot.time);
    }
    if (
      facts.some(
        (fact) =>
          fact.kind === 'emergency-brake' &&
          fact.detail.activated === true &&
          fact.detail.hazardActive === false,
      )
    ) {
      this.emitFeedback('feedback-false-emergency-brake', snapshot.time);
    }
  }

  private captureRequests(snapshot: GameAttemptSnapshot): void {
    const hint = this.byTrigger.get('passenger-request-unhandled');
    if (hint?.afterUs === undefined || hint.requestActionIds === undefined) return;
    const requestIds = new Set(hint.requestActionIds);
    const passengers = snapshot.entities
      .filter((entity) => entity.kind === 'passenger')
      .sort((left, right) => compareIds(left.id, right.id));
    const present = new Set(passengers.map((entity) => entity.id));
    this.dropAbsentRequests(snapshot.time, hint, present);
    for (const entity of passengers) {
      this.observeRequest(
        hint,
        entity.id,
        requestKey(entity.currentAction, requestIds),
        snapshot.time,
      );
    }
  }

  private observeRequest(
    hint: HintDefinition,
    entityId: string,
    request: { readonly key: string; readonly startedAt: SimTimeUs } | null,
    now: SimTimeUs,
  ): void {
    const key = request?.key ?? null;
    const previous = this.requests.get(entityId);
    if (previous !== undefined && previous.key !== key) {
      this.finishRequest(hint, entityId, previous, now);
    }
    if (request === null) return;
    const current = this.requests.get(entityId);
    if (current === undefined || current.key !== request.key) {
      this.requests.set(entityId, {
        key: request.key,
        startedAt: request.startedAt,
        hinted: false,
      });
    }
    const watch = this.requests.get(entityId);
    const afterUs = hint.afterUs;
    if (watch === undefined || watch.hinted || watch.key !== request.key || afterUs === undefined) {
      return;
    }
    const due = watch.startedAt + afterUs;
    if (now < due) return;
    this.emitPassenger(hint, entityId, due, watch.key);
    watch.hinted = true;
  }

  private dropAbsentRequests(
    now: SimTimeUs,
    hint: HintDefinition,
    present: ReadonlySet<string>,
  ): void {
    const afterUs = hint.afterUs;
    if (afterUs === undefined) return;
    for (const [id, watch] of this.requests) {
      if (present.has(id)) continue;
      if (!watch.hinted && now >= watch.startedAt + afterUs) {
        this.emitPassenger(hint, id, watch.startedAt + afterUs, watch.key);
      }
      this.requests.delete(id);
    }
  }

  private finishRequest(
    hint: HintDefinition,
    entityId: string,
    watch: RequestWatch,
    now: SimTimeUs,
  ): void {
    const afterUs = hint.afterUs;
    if (afterUs === undefined) return;
    const due = watch.startedAt + afterUs;
    if (!watch.hinted && now >= due) {
      this.emitPassenger(hint, entityId, due, watch.key);
      watch.hinted = true;
      return;
    }
    if (watch.key !== this.requests.get(entityId)?.key) return;
    this.requests.delete(entityId);
  }

  private captureInactivity(snapshot: GameAttemptSnapshot): void {
    if (!this.policy?.suggestions) return;
    const hint = this.byTrigger.get('inactivity');
    if (hint?.afterUs === undefined || hint.repeatable !== true) return;
    const preDeparture = snapshot.phase.kind === 'pre-departure' && snapshot.termination === null;
    if (!preDeparture && !this.inPreDeparture) return;
    // A jump that leaves pre-departure still owes idle hints from inside that phase.
    const inclusive = preDeparture;
    while (
      inclusive ? this.nextInactivityAt <= snapshot.time : this.nextInactivityAt < snapshot.time
    ) {
      const at = this.nextInactivityAt;
      this.nextInactivityAt += hint.afterUs;
      this.emitRepeat(hint, at, snapshot);
    }
    this.inPreDeparture = preDeparture;
  }

  private emitRepeat(hint: HintDefinition, at: SimTimeUs, snapshot: GameAttemptSnapshot): void {
    const sourceTrigger =
      snapshot.termination === null ? objectiveTrigger(snapshot) : 'attempt-start';
    const source = this.byTrigger.get(sourceTrigger);
    if (source?.text === undefined) return;
    this.emit(at, hintPayload(hint.id, hint.presentation, source.text, source.target));
  }

  private emitFeedback(trigger: HintTrigger, at: SimTimeUs, target?: PublicTargetRef): void {
    if (!this.policy?.immediateFeedback) return;
    const hint = this.byTrigger.get(trigger);
    if (hint === undefined) return;
    const resolved = target ?? hint.target;
    const key = emissionKey(hint.id, resolved);
    if (this.emitted.has(key)) return;
    this.emitted.add(key);
    const text = this.policy.explanations ? hint.text : undefined;
    this.emit(at, hintPayload(hint.id, hint.presentation, text, resolved));
  }

  private emitDefined(
    hint: HintDefinition,
    at: SimTimeUs,
    target: HintObjectTarget | undefined,
  ): void {
    if (this.emitted.has(hint.id)) return;
    this.emitted.add(hint.id);
    this.emit(at, hintPayload(hint.id, hint.presentation, hint.text, target));
  }

  private emitPassenger(hint: HintDefinition, entityId: string, at: SimTimeUs, key: string): void {
    const once = `${hint.id}:${entityId}:${key}`;
    if (this.emitted.has(once)) return;
    this.emitted.add(once);
    this.emit(at, hintPayload(hint.id, hint.presentation, hint.text, { kind: 'entity', entityId }));
  }
}

function objectiveTrigger(snapshot: GameAttemptSnapshot): ObjectiveTrigger {
  const journal = snapshot.items.journal;
  const phase = snapshot.phase.kind;
  if (journal.submitted || phase === 'origin-stop' || phase === 'travel' || phase === 'stop') {
    return 'meet-passengers';
  }
  if (journal.location === 'held' && acceptanceJournalIsComplete(journal) && journal.accepted) {
    return 'journal-filled';
  }
  if (journal.location === 'held') return 'journal-taken';
  return 'attempt-start';
}

function hintPayload(
  hintId: string,
  presentation: HintDefinition['presentation'],
  text: string | undefined,
  target: PublicTargetRef | HintObjectTarget | undefined,
): PresentationEventPayload {
  const event: {
    kind: 'hint';
    hintId: string;
    presentation: HintDefinition['presentation'];
    text?: string;
    target?: PublicTargetRef;
  } = { kind: 'hint', hintId, presentation };
  if (text !== undefined) event.text = text;
  if (target !== undefined) event.target = target;
  return event;
}

function emissionKey(
  hintId: string,
  target: PublicTargetRef | HintObjectTarget | undefined,
): string {
  if (target?.kind === 'entity') return `${hintId}:${target.entityId}`;
  if (target?.kind === 'object') return `${hintId}:${target.objectId}`;
  return hintId;
}

function requestKey(
  action: { actionId: string; generation: number; startedAt: number } | undefined,
  requestIds: ReadonlySet<string>,
): { readonly key: string; readonly startedAt: SimTimeUs } | null {
  if (action === undefined || !requestIds.has(action.actionId)) return null;
  return { key: actionKey(action), startedAt: action.startedAt };
}

function actionKey(action: { actionId: string; generation: number; startedAt: number }): string {
  return `${action.actionId}:${action.generation}:${action.startedAt}`;
}

function compareIds(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
