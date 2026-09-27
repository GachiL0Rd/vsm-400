import {
  GAME_PROTOCOL_VERSION,
  type PresentationEventMessage,
  type PresentationEventPayload,
} from '../common/game-wire';
import type { CurrentAction } from '../simulation/entity-store';
import type {
  AttemptPhase,
  AttemptTermination,
  GameAttempt,
  GameAttemptSnapshot,
} from '../simulation/game-attempt';
import type { SimTimeUs } from '../simulation/sim-time';

interface PhaseNotice {
  readonly notificationId: string;
  readonly text: string;
}

interface PendingEvent {
  readonly at: SimTimeUs;
  readonly event: PresentationEventPayload;
}

interface SeenPassenger {
  readonly actionKey: string | null;
  readonly traits: ReadonlySet<string>;
}

/**
 * Derives transient presentation events from authoritative steps.
 *
 * Events stay out of snapshots. `beginSlice` drops anything not yet drained,
 * so only the worker publication that follows a projection call sends them.
 * Within one step the order is: action speech, trait speech, phase notice,
 * termination notice, achievement-unlocked.
 */
export class PresentationTracker {
  private sequence = 0;
  private pending: PendingEvent[] = [];
  private phase: AttemptPhase;
  private terminated: boolean;
  private readonly seen = new Map<string, SeenPassenger>();
  private readonly emittedAchievements = new Set<string>();

  constructor(
    private readonly attempt: GameAttempt,
    private readonly attemptId: string,
  ) {
    const snapshot = attempt.snapshot();
    this.phase = snapshot.phase;
    this.terminated = snapshot.termination !== null;
    this.remember(snapshot);
  }

  bind(): void {
    this.attempt.observeSteps(() => {
      this.capture();
    });
  }

  beginSlice(): void {
    this.pending = [];
  }

  capture(): void {
    const snapshot = this.attempt.snapshot();
    this.captureSpeech(snapshot);
    this.capturePhase(snapshot);
    this.captureTermination(snapshot);
  }

  drain(): PresentationEventMessage[] {
    const messages = this.pending.map((item) => this.seal(item));
    this.pending = [];
    return messages;
  }

  private captureSpeech(snapshot: GameAttemptSnapshot): void {
    const passengers = snapshot.entities
      .filter((entity) => entity.kind === 'passenger')
      .sort((left, right) => compareIds(left.id, right.id));
    const present = new Set(passengers.map((entity) => entity.id));
    for (const id of this.seen.keys()) {
      if (!present.has(id)) this.seen.delete(id);
    }
    for (const entity of passengers) {
      const previous = this.seen.get(entity.id);
      const action = speechForAction(
        this.attempt,
        entity.id,
        entity.currentAction,
        previous?.actionKey ?? null,
      );
      if (action !== null) this.pending.push(action);
      const traits = speechesForNewTraits(
        this.attempt,
        entity.id,
        entity.traits,
        previous?.traits ?? EMPTY_TRAITS,
      );
      for (const line of traits) this.pending.push(line);
      this.seen.set(entity.id, {
        actionKey: actionKey(entity.currentAction),
        traits: new Set(entity.traits),
      });
    }
  }

  private capturePhase(snapshot: GameAttemptSnapshot): void {
    const previous = this.phase;
    this.phase = snapshot.phase;
    const notice = phaseNotice(previous, snapshot.phase);
    if (notice === null) return;
    this.push(snapshot.time, {
      kind: 'notification',
      notificationId: notice.notificationId,
      text: notice.text,
    });
  }

  private captureTermination(snapshot: GameAttemptSnapshot): void {
    const termination = snapshot.termination;
    if (termination === null || this.terminated) return;
    this.terminated = true;
    const notice = terminationNotice(termination);
    this.push(termination.at, {
      kind: 'notification',
      notificationId: notice.notificationId,
      text: notice.text,
    });
    this.captureAchievements(termination.at);
  }

  private captureAchievements(at: SimTimeUs): void {
    for (const achievementId of this.attempt.assessmentResult().achievements.ids) {
      if (this.emittedAchievements.has(achievementId)) continue;
      this.emittedAchievements.add(achievementId);
      this.push(at, { kind: 'achievement-unlocked', achievementId });
    }
  }

  private remember(snapshot: GameAttemptSnapshot): void {
    for (const entity of snapshot.entities) {
      if (entity.kind !== 'passenger') continue;
      this.seen.set(entity.id, {
        actionKey: actionKey(entity.currentAction),
        traits: new Set(entity.traits),
      });
    }
  }

  private push(at: SimTimeUs, event: PresentationEventPayload): void {
    this.pending.push({ at, event });
  }

  private seal(item: PendingEvent): PresentationEventMessage {
    const sequence = this.sequence;
    if (!Number.isSafeInteger(sequence)) {
      throw new RangeError('Presentation sequence overflow');
    }
    this.sequence += 1;
    return {
      protocolVersion: GAME_PROTOCOL_VERSION,
      type: 'presentation-event',
      attemptId: this.attemptId,
      at: item.at,
      sequence,
      event: item.event,
    };
  }
}

const EMPTY_TRAITS: ReadonlySet<string> = new Set();

function speechForAction(
  attempt: GameAttempt,
  entityId: string,
  action: CurrentAction | undefined,
  previousKey: string | null,
): PendingEvent | null {
  const key = actionKey(action);
  if (key === null || key === previousKey || action === undefined) return null;
  const text = attempt.catalog.actionSpeech(action.actionId);
  if (text === undefined) return null;
  return {
    at: action.startedAt,
    event: { kind: 'speech', entityId, text, visible: true },
  };
}

function speechesForNewTraits(
  attempt: GameAttempt,
  entityId: string,
  traits: readonly string[],
  previous: ReadonlySet<string>,
): PendingEvent[] {
  const grantedAt = attempt.entities.traitGrantedAt(entityId);
  const added = traits.filter((traitId) => !previous.has(traitId)).sort(compareIds);
  const lines: PendingEvent[] = [];
  for (const traitId of added) {
    const text = attempt.catalog.traitSpeech(traitId);
    if (text === undefined) continue;
    lines.push({
      at: grantedAt[traitId] ?? attempt.time,
      event: { kind: 'speech', entityId, text, visible: true },
    });
  }
  return lines;
}

function actionKey(action: CurrentAction | undefined): string | null {
  if (action === undefined) return null;
  return `${action.actionId}:${action.generation}:${action.startedAt}`;
}

function phaseNotice(before: AttemptPhase, after: AttemptPhase): PhaseNotice | null {
  if (samePhase(before, after) || after.kind === 'finished') return null;
  if (before.kind === 'pre-departure' && after.kind === 'origin-stop') {
    return { notificationId: 'phase:origin-stop', text: 'Посадка пассажиров открыта' };
  }
  if (before.kind === 'origin-stop' && after.kind === 'travel') {
    return { notificationId: 'phase:travel', text: 'Поезд отправился' };
  }
  if (before.kind === 'travel' && after.kind === 'stop') return arrivalNotice(after.stopIndex);
  if (before.kind === 'stop' && after.kind === 'travel') return departureNotice(before.stopIndex);
  return null;
}

function arrivalNotice(stopIndex: number): PhaseNotice {
  return {
    notificationId: `phase:stop:${stopIndex}`,
    text: `Прибытие: остановка ${stopIndex + 1}`,
  };
}

function departureNotice(stopIndex: number): PhaseNotice {
  return { notificationId: `phase:depart:${stopIndex}`, text: 'Отправление' };
}

function terminationNotice(termination: AttemptTermination): PhaseNotice {
  if (termination.kind === 'route-completed') {
    return { notificationId: 'termination:route-completed', text: 'Рейс завершён' };
  }
  return { notificationId: 'termination:terminal-rule', text: 'Рейс прерван' };
}

function samePhase(before: AttemptPhase, after: AttemptPhase): boolean {
  if (before.kind !== after.kind) return false;
  if (before.kind === 'travel' && after.kind === 'travel') {
    return before.nextStopIndex === after.nextStopIndex;
  }
  if (before.kind === 'stop' && after.kind === 'stop') {
    return before.stopIndex === after.stopIndex && before.stopId === after.stopId;
  }
  return true;
}

function compareIds(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
