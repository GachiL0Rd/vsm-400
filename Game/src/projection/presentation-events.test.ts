import { describe, expect, it } from 'vitest';
import {
  GAME_PROTOCOL_VERSION,
  type PresentationEventMessage,
  presentationEventSchema,
  type SessionModeView,
} from '../common/game-wire';
import { BASELINE_ACTION_CONTENT } from '../simulation/baseline-content';
import { GameAttempt } from '../simulation/game-attempt';
import { BASELINE_LEVEL } from '../simulation/level';
import { BASELINE_SCENARIO_DEFINITION, loadScenarioDefinition } from '../simulation/scenario';
import { secondsToSimTimeUs } from '../simulation/sim-time';
import { PublicGameProjection } from './public-game-session';

const GUIDED: SessionModeView = {
  kind: 'guided',
  hints: {
    immediateFeedback: true,
    suggestions: true,
    objectHighlights: true,
    explanations: true,
  },
};

function quietScenario() {
  return loadScenarioDefinition({ ...BASELINE_SCENARIO_DEFINITION, incidents: [] }, BASELINE_LEVEL);
}

function collect(projection: PublicGameProjection, into: PresentationEventMessage[]): void {
  into.push(...projection.takePresentationEvents());
}

function completeJournal(projection: PublicGameProjection): void {
  const takeOffer = projection.queryActions({
    protocolVersion: GAME_PROTOCOL_VERSION,
    type: 'query-actions',
    requestId: 'query-journal',
    knownRevision: projection.revision,
    target: { kind: 'object', objectId: 'acceptance-journal' },
  });
  const take = takeOffer.actions.find((action) => action.label === 'Взять журнал приёмки');
  const taken = projection.invoke({
    protocolVersion: GAME_PROTOCOL_VERSION,
    type: 'invoke-action',
    requestId: 'take-journal',
    knownRevision: projection.revision,
    actionHandle: take?.handle ?? 'missing',
  });
  if (taken.result.status !== 'accepted') throw new Error('Journal take was rejected');

  const editOffer = projection.queryActions({
    protocolVersion: GAME_PROTOCOL_VERSION,
    type: 'query-actions',
    requestId: 'query-self',
    knownRevision: projection.revision,
    target: { kind: 'entity', entityId: 'player' },
  });
  const edit = editOffer.actions.find((action) => action.uiKind === 'form');
  const edited = projection.invoke({
    protocolVersion: GAME_PROTOCOL_VERSION,
    type: 'invoke-action',
    requestId: 'edit-journal',
    knownRevision: projection.revision,
    actionHandle: edit?.handle ?? 'missing',
    input: {
      communication: 'ok',
      extinguisher: 'ok',
      climate: 'ok',
      emergencyBrake: 'ok',
      sanitation: 'clean',
      note: '',
      accepted: true,
    },
  });
  if (edited.result.status !== 'accepted') throw new Error('Journal edit was rejected');

  const returnOffer = projection.queryActions({
    protocolVersion: GAME_PROTOCOL_VERSION,
    type: 'query-actions',
    requestId: 'query-self-return',
    knownRevision: projection.revision,
    target: { kind: 'entity', entityId: 'player' },
  });
  const submit = returnOffer.actions.find((action) => action.label === 'Сдать журнал приёмки');
  const returned = projection.invoke({
    protocolVersion: GAME_PROTOCOL_VERSION,
    type: 'invoke-action',
    requestId: 'return-journal',
    knownRevision: projection.revision,
    actionHandle: submit?.handle ?? 'missing',
  });
  if (returned.result.status !== 'accepted') throw new Error('Journal return was rejected');
}

function decideBoarding(
  projection: PublicGameProjection,
  passengerId: string,
  decision: 'admit' | 'reject',
): void {
  const offer = projection.queryActions({
    protocolVersion: GAME_PROTOCOL_VERSION,
    type: 'query-actions',
    requestId: `query-documents-${passengerId}`,
    knownRevision: projection.revision,
    target: { kind: 'entity', entityId: passengerId },
  });
  const action = offer.actions.find((candidate) => candidate.form?.kind === 'passenger-documents');
  if (action === undefined) throw new Error(`Missing passenger document action for ${passengerId}`);
  const result = projection.invoke({
    protocolVersion: GAME_PROTOCOL_VERSION,
    type: 'invoke-action',
    requestId: `decide-${passengerId}`,
    knownRevision: projection.revision,
    actionHandle: action.handle,
    input: { decision },
  });
  if (result.result.status !== 'accepted') {
    throw new Error(`Boarding decision rejected for ${passengerId}`);
  }
}

function drinkRequest(mode?: SessionModeView): PresentationEventMessage[] {
  const projection = new PublicGameProjection({
    attemptId: 'attempt-drink',
    attempt: new GameAttempt({ rootSeed: 4 }),
    ...(mode === undefined ? {} : { mode }),
  });
  const events: PresentationEventMessage[] = [];
  projection.snapshot();
  completeJournal(projection);
  collect(projection, events);
  projection.advanceTo(secondsToSimTimeUs(5 * 60));
  collect(projection, events);
  decideBoarding(projection, 'passenger-3', 'admit');
  collect(projection, events);
  const action = projection.attempt.entities.get('passenger-3').currentAction;
  if (action?.actionId !== 'request-drink') {
    throw new Error(`Expected request-drink, got ${action?.actionId ?? 'none'}`);
  }
  projection.advanceTo(action.startedAt + secondsToSimTimeUs(120));
  collect(projection, events);
  expect(JSON.stringify(projection.snapshot())).not.toContain('Можно воды?');
  expect(projection.takePresentationEvents()).toEqual([]);
  return events;
}

function quietRoute(): PresentationEventMessage[] {
  const attempt = new GameAttempt({ rootSeed: 4, scenario: quietScenario() });
  const projection = new PublicGameProjection({
    attemptId: 'attempt-route',
    attempt,
  });
  const events: PresentationEventMessage[] = [];
  projection.snapshot();
  completeJournal(projection);
  collect(projection, events);
  projection.advanceTo(secondsToSimTimeUs(5 * 60));
  collect(projection, events);
  decideBoarding(projection, 'passenger-1', 'admit');
  collect(projection, events);
  decideBoarding(projection, 'passenger-2', 'admit');
  collect(projection, events);
  decideBoarding(projection, 'passenger-3', 'reject');
  collect(projection, events);
  projection.advanceTo(attempt.scenario.normalEndTimeUs);
  collect(projection, events);
  return events;
}

function summarize(events: readonly PresentationEventMessage[]): string[] {
  return events.map((event) => {
    const payload = event.event;
    if (payload.kind === 'speech') {
      return `speech ${event.at} ${payload.entityId} ${payload.text}`;
    }
    if (payload.kind === 'notification') {
      return `notification ${event.at} ${payload.text}`;
    }
    if (payload.kind === 'achievement-unlocked') {
      return `achievement-unlocked ${event.at} ${payload.achievementId}`;
    }
    return `${payload.kind} ${event.at}`;
  });
}

function assertNoHiddenIds(events: readonly PresentationEventMessage[], publicJson: string): void {
  const hidden = new Set<string>(['currentAction', 'traitGrantedAt', 'rootSeed']);
  for (const action of BASELINE_ACTION_CONTENT.actions) hidden.add(action.id);
  for (const trait of BASELINE_ACTION_CONTENT.traits) hidden.add(trait.id);
  const leaked: string[] = [];
  for (const event of events) {
    const json = JSON.stringify(event.event);
    for (const token of hidden) {
      if (!publicJson.includes(token) && json.includes(token)) leaked.push(`${token} in ${json}`);
    }
  }
  expect(leaked).toEqual([]);
}

describe('presentation events', () => {
  it('emits a drink request line and annoyed speech with authoritative times', () => {
    const events = drinkRequest();
    for (const event of events) expect(presentationEventSchema.parse(event)).toEqual(event);
    expect(events.map((event) => event.sequence)).toEqual(events.map((_, index) => index));

    const drink = events.find(
      (event) => event.event.kind === 'speech' && event.event.text === 'Можно воды?',
    );
    expect(drink?.event).toEqual({
      kind: 'speech',
      entityId: 'passenger-3',
      text: 'Можно воды?',
      visible: true,
    });
    expect(drink?.at).toBe(secondsToSimTimeUs(5 * 60));

    const annoyed = events.find(
      (event) => event.event.kind === 'speech' && event.event.text === 'Сколько можно ждать?',
    );
    expect(annoyed?.event).toMatchObject({
      kind: 'speech',
      entityId: 'passenger-3',
      visible: true,
    });
    expect(annoyed?.at).toBe(secondsToSimTimeUs(7 * 60));
    expect(
      events.some((event) => event.event.kind === 'hint' || event.event.kind === 'effect'),
    ).toBe(false);
    assertNoHiddenIds(events, '{}');
    expect(summarize(events)).toEqual([
      'notification 300000000 Посадка пассажиров открыта',
      'speech 300000000 passenger-3 Можно воды?',
      'speech 420000000 passenger-3 Сколько можно ждать?',
      // Timeout clears the request, then the decision engine starts it again.
      'speech 420000000 passenger-3 Можно воды?',
    ]);
  });

  it('keeps guided mode free of hints and repeats the same list for the same seed', () => {
    const live = drinkRequest();
    const guided = drinkRequest(GUIDED);
    expect(guided).toEqual(live);
    expect(guided.some((event) => event.event.kind === 'hint')).toBe(false);
    expect(drinkRequest()).toEqual(live);
  });

  it('emits phase notifications in order and each achievement once', () => {
    const events = quietRoute();
    expect(events.map((event) => event.sequence)).toEqual(events.map((_, index) => index));
    const notifications = events.flatMap((event) =>
      event.event.kind === 'notification' ? [event.event.notificationId] : [],
    );
    expect(notifications).toEqual([
      'phase:origin-stop',
      'phase:travel',
      'phase:stop:0',
      'phase:depart:0',
      'phase:stop:1',
      'termination:route-completed',
    ]);
    const achievements = events.flatMap((event) =>
      event.event.kind === 'achievement-unlocked' ? [event.event.achievementId] : [],
    );
    expect(achievements).toEqual(['clean-predeparture', 'documents-perfect']);
    expect(new Set(achievements).size).toBe(achievements.length);
    const finishedAt = events.find(
      (event) =>
        event.event.kind === 'notification' &&
        event.event.notificationId === 'termination:route-completed',
    )?.at;
    expect(
      events
        .filter((event) => event.event.kind === 'achievement-unlocked')
        .every((event) => event.at === finishedAt),
    ).toBe(true);
    expect(
      events.some((event) => event.event.kind === 'hint' || event.event.kind === 'effect'),
    ).toBe(false);
    assertNoHiddenIds(events, '{}');
  });
});
