import { describe, expect, it } from 'vitest';
import {
  type AcceptanceJournalInput,
  GAME_PROTOCOL_VERSION,
  type PresentationEventMessage,
  type PublicTargetRef,
  presentationEventSchema,
  type SessionModeView,
} from '../common/game-wire';
import type { AssessmentResult } from '../simulation/assessment';
import { GameAttempt } from '../simulation/game-attempt';
import { BASELINE_LEVEL } from '../simulation/level';
import { BASELINE_SCENARIO_DEFINITION, loadScenarioDefinition } from '../simulation/scenario';
import { secondsToSimTimeUs } from '../simulation/sim-time';
import {
  BASELINE_HINT_CONTENT,
  type HintContent,
  type HintTrigger,
  loadHintContent,
} from './hint-content';
import { PublicGameProjection } from './public-game-session';

const JOURNAL: PublicTargetRef = { kind: 'object', objectId: 'acceptance-journal' };

const ALL_ON: SessionModeView = {
  kind: 'guided',
  hints: {
    immediateFeedback: true,
    suggestions: true,
    objectHighlights: true,
    explanations: true,
  },
};

function guided(
  overrides?: Partial<Extract<SessionModeView, { kind: 'guided' }>['hints']>,
): SessionModeView {
  if (ALL_ON.kind !== 'guided') throw new Error('Expected guided policy');
  return {
    kind: 'guided',
    hints: { ...ALL_ON.hints, ...overrides },
  };
}

function quietScenario() {
  return loadScenarioDefinition({ ...BASELINE_SCENARIO_DEFINITION, incidents: [] }, BASELINE_LEVEL);
}

function hintText(trigger: HintTrigger): string {
  const hint = BASELINE_HINT_CONTENT.hints.find((item) => item.trigger === trigger);
  if (hint?.text === undefined) throw new Error(`Missing hint text for ${trigger}`);
  return hint.text;
}

function open(
  mode: SessionModeView,
  seed = 4,
): { projection: PublicGameProjection; attempt: GameAttempt } {
  const attempt = new GameAttempt({ rootSeed: seed });
  const projection = new PublicGameProjection({
    attemptId: 'attempt-hints',
    attempt,
    mode,
    hints: BASELINE_HINT_CONTENT,
  });
  return { projection, attempt };
}

function collect(projection: PublicGameProjection, into: PresentationEventMessage[]): void {
  into.push(...projection.takePresentationEvents());
}

function invoke(
  projection: PublicGameProjection,
  target: PublicTargetRef,
  label: string,
  input?: AcceptanceJournalInput,
): void {
  const offer = projection.queryActions({
    protocolVersion: GAME_PROTOCOL_VERSION,
    type: 'query-actions',
    requestId: `query-${label}`,
    knownRevision: projection.revision,
    target,
  });
  const action = offer.actions.find((candidate) => candidate.label === label);
  if (action === undefined) throw new Error(`Missing action ${label}`);
  const result = projection.invoke({
    protocolVersion: GAME_PROTOCOL_VERSION,
    type: 'invoke-action',
    requestId: `invoke-${label}`,
    knownRevision: projection.revision,
    actionHandle: action.handle,
    ...(input === undefined ? {} : { input }),
  });
  if (result.result.status !== 'accepted') {
    throw new Error(`${label} rejected: ${result.result.message}`);
  }
}

function fillJournal(
  projection: PublicGameProjection,
  communication: 'ok' | 'problem' = 'ok',
): void {
  invoke(projection, JOURNAL, 'Взять журнал приёмки');
  invoke(projection, { kind: 'entity', entityId: 'player' }, 'Редактировать журнал приёмки', {
    communication,
    extinguisher: 'ok',
    climate: 'ok',
    emergencyBrake: 'ok',
    sanitation: 'clean',
    note: '',
    accepted: true,
  });
  invoke(projection, { kind: 'entity', entityId: 'player' }, 'Сдать журнал приёмки');
}

function decide(
  projection: PublicGameProjection,
  passengerId: string,
  decision: 'admit' | 'reject',
): void {
  const offer = projection.queryActions({
    protocolVersion: GAME_PROTOCOL_VERSION,
    type: 'query-actions',
    requestId: `query-${passengerId}`,
    knownRevision: projection.revision,
    target: { kind: 'entity', entityId: passengerId },
  });
  const action = offer.actions.find((candidate) => candidate.form?.kind === 'passenger-documents');
  if (action === undefined) throw new Error(`Missing documents for ${passengerId}`);
  const result = projection.invoke({
    protocolVersion: GAME_PROTOCOL_VERSION,
    type: 'invoke-action',
    requestId: `decide-${passengerId}`,
    knownRevision: projection.revision,
    actionHandle: action.handle,
    input: { decision },
  });
  if (result.result.status !== 'accepted') throw new Error(`Decision rejected for ${passengerId}`);
}

interface HintView {
  readonly hintId: string;
  readonly at: number;
  readonly presentation: string;
  readonly text: string | null;
  readonly target: PublicTargetRef | null;
}

function hintViews(events: readonly PresentationEventMessage[]): HintView[] {
  return events.flatMap((event) => {
    if (event.event.kind !== 'hint') return [];
    return [
      {
        hintId: event.event.hintId,
        at: event.at,
        presentation: event.event.presentation,
        text: event.event.text ?? null,
        target: event.event.target ?? null,
      },
    ];
  });
}

/** Journal path, idle through pre-departure, then one unanswered passenger request. */
function scripted(mode: SessionModeView): PresentationEventMessage[] {
  const { projection, attempt } = open(mode);
  const events: PresentationEventMessage[] = [];
  const originAt = attempt.scenario.definition.preDeparture.durationUs;
  projection.advanceTo(0);
  collect(projection, events);
  invoke(projection, JOURNAL, 'Взять журнал приёмки');
  collect(projection, events);
  invoke(projection, { kind: 'entity', entityId: 'player' }, 'Редактировать журнал приёмки', {
    communication: 'ok',
    extinguisher: 'ok',
    climate: 'ok',
    emergencyBrake: 'ok',
    sanitation: 'clean',
    note: '',
    accepted: true,
  });
  collect(projection, events);
  invoke(projection, { kind: 'entity', entityId: 'player' }, 'Сдать журнал приёмки');
  collect(projection, events);
  projection.advanceTo(secondsToSimTimeUs(60));
  collect(projection, events);
  projection.advanceTo(originAt);
  collect(projection, events);
  decide(projection, 'passenger-3', 'admit');
  collect(projection, events);
  const request = projection.attempt.entities.get('passenger-3').currentAction;
  if (request?.actionId !== 'request-drink') {
    throw new Error(`Expected request-drink, got ${request?.actionId ?? 'none'}`);
  }
  projection.advanceTo(request.startedAt + secondsToSimTimeUs(90));
  collect(projection, events);
  return events;
}

function correctRoute(mode: SessionModeView): {
  assessment: AssessmentResult;
  hints: HintView[];
  commands: string[];
} {
  const attempt = new GameAttempt({ rootSeed: 4, scenario: quietScenario() });
  const projection = new PublicGameProjection({
    attemptId: 'attempt-score',
    attempt,
    mode,
    hints: BASELINE_HINT_CONTENT,
  });
  const events: PresentationEventMessage[] = [];
  const commands: string[] = [];
  const take = (label: string, target: PublicTargetRef, input?: AcceptanceJournalInput) => {
    invoke(projection, target, label, input);
    commands.push(label);
    collect(projection, events);
  };
  projection.advanceTo(0);
  collect(projection, events);
  take('Взять журнал приёмки', JOURNAL);
  take(
    'Редактировать журнал приёмки',
    { kind: 'entity', entityId: 'player' },
    {
      communication: 'ok',
      extinguisher: 'ok',
      climate: 'ok',
      emergencyBrake: 'ok',
      sanitation: 'clean',
      note: '',
      accepted: true,
    },
  );
  take('Сдать журнал приёмки', { kind: 'entity', entityId: 'player' });
  projection.advanceTo(attempt.scenario.definition.preDeparture.durationUs);
  collect(projection, events);
  decide(projection, 'passenger-1', 'admit');
  commands.push('admit passenger-1');
  collect(projection, events);
  decide(projection, 'passenger-2', 'admit');
  commands.push('admit passenger-2');
  collect(projection, events);
  decide(projection, 'passenger-3', 'reject');
  commands.push('reject passenger-3');
  collect(projection, events);
  projection.advanceTo(attempt.scenario.normalEndTimeUs);
  collect(projection, events);
  return { assessment: attempt.assessmentResult(), hints: hintViews(events), commands };
}

describe('guided coaching hints', () => {
  it('emits the start hint first and the inspection hint after the journal is taken', () => {
    const events = scripted(guided());
    for (const event of events) expect(presentationEventSchema.parse(event)).toEqual(event);
    expect(events.map((event) => event.sequence)).toEqual(events.map((_, index) => index));

    const hints = hintViews(events);
    const start = hintText('attempt-start');
    const inspect = hintText('journal-taken');
    const returned = hintText('journal-filled');
    const meet = hintText('meet-passengers');
    const waiting = hintText('passenger-request-unhandled');
    const unsafe = hintText('feedback-unsafe-admit');
    const originAt = 300_000_000;
    const idle = [60, 120, 180, 240].map((seconds) => secondsToSimTimeUs(seconds));
    expect(hints).toEqual([
      {
        hintId: 'attempt-start',
        at: 0,
        presentation: 'message',
        text: start,
        target: JOURNAL,
      },
      {
        hintId: 'journal-taken',
        at: 0,
        presentation: 'message',
        text: inspect,
        target: null,
      },
      {
        hintId: 'highlight-extinguisher',
        at: 0,
        presentation: 'highlight',
        text: null,
        target: { kind: 'object', objectId: 'extinguisher' },
      },
      {
        hintId: 'highlight-emergency-brake',
        at: 0,
        presentation: 'highlight',
        text: null,
        target: { kind: 'object', objectId: 'emergency-brake' },
      },
      {
        hintId: 'highlight-climate-control',
        at: 0,
        presentation: 'highlight',
        text: null,
        target: { kind: 'object', objectId: 'climate-control' },
      },
      {
        hintId: 'highlight-driver-comms',
        at: 0,
        presentation: 'highlight',
        text: null,
        target: { kind: 'object', objectId: 'driver-comms' },
      },
      {
        hintId: 'journal-filled',
        at: 0,
        presentation: 'message',
        text: returned,
        target: JOURNAL,
      },
      {
        hintId: 'meet-passengers',
        at: 0,
        presentation: 'message',
        text: meet,
        target: null,
      },
      ...idle.map((at) => ({
        hintId: 'inactivity',
        at,
        presentation: 'message',
        text: meet,
        target: null,
      })),
      {
        hintId: 'feedback-unsafe-admit',
        at: originAt,
        presentation: 'toast',
        text: unsafe,
        target: { kind: 'entity', entityId: 'passenger-3' },
      },
      {
        hintId: 'passenger-waiting',
        at: originAt + 30_000_000,
        presentation: 'toast',
        text: waiting,
        target: { kind: 'entity', entityId: 'passenger-3' },
      },
    ]);
    expect(hints[0]?.hintId).toBe('attempt-start');
    expect(hints.find((hint) => hint.hintId === 'journal-taken')?.at).toBe(0);
  });

  it('emits no hints in live mode', () => {
    const events = scripted({ kind: 'live' });
    expect(events.some((event) => event.event.kind === 'hint')).toBe(false);
  });

  it('omits feedback toasts when immediateFeedback is off and highlights when highlights are off', () => {
    const withoutFeedback = hintViews(scripted(guided({ immediateFeedback: false })));
    expect(withoutFeedback.some((hint) => hint.hintId.startsWith('feedback-'))).toBe(false);
    expect(withoutFeedback.some((hint) => hint.hintId === 'attempt-start')).toBe(true);
    expect(withoutFeedback.some((hint) => hint.hintId === 'passenger-waiting')).toBe(true);

    const { projection } = open(guided({ objectHighlights: false }));
    invoke(projection, JOURNAL, 'Взять журнал приёмки');
    const hints = hintViews(projection.takePresentationEvents());
    expect(hints.map((hint) => hint.hintId)).toEqual(['attempt-start', 'journal-taken']);
    expect(hints.some((hint) => hint.presentation === 'highlight')).toBe(false);
  });

  it('omits feedback text when explanations are off', () => {
    const { projection, attempt } = open(guided({ explanations: false }));
    projection.advanceTo(attempt.scenario.definition.preDeparture.durationUs);
    fillJournal(projection);
    projection.advanceTo(attempt.scenario.definition.preDeparture.durationUs);
    decide(projection, 'passenger-1', 'reject');
    const wrong = hintViews(projection.takePresentationEvents()).find(
      (hint) => hint.hintId === 'feedback-wrong-reject',
    );
    expect(wrong).toMatchObject({
      presentation: 'toast',
      text: null,
      target: { kind: 'entity', entityId: 'passenger-1' },
    });
  });

  it('explains a false journal report and a false emergency brake without changing the other mode', () => {
    const falseJournal = (mode: SessionModeView) => {
      const { projection, attempt } = open(mode, 8);
      projection.advanceTo(0);
      invoke(projection, JOURNAL, 'Взять журнал приёмки');
      invoke(projection, { kind: 'entity', entityId: 'player' }, 'Редактировать журнал приёмки', {
        communication: 'problem',
        extinguisher: 'ok',
        climate: 'ok',
        emergencyBrake: 'ok',
        sanitation: 'clean',
        note: '',
        accepted: true,
      });
      const events: PresentationEventMessage[] = [];
      invoke(projection, { kind: 'entity', entityId: 'player' }, 'Сдать журнал приёмки');
      collect(projection, events);
      return { events, attempt };
    };
    const guidedJournal = falseJournal(guided());
    const liveJournal = falseJournal({ kind: 'live' });
    expect(hintViews(guidedJournal.events).map((hint) => hint.hintId)).toContain(
      'feedback-false-journal',
    );
    expect(hintViews(guidedJournal.events).some((hint) => hint.hintId === 'meet-passengers')).toBe(
      false,
    );
    expect(hintViews(liveJournal.events)).toEqual([]);
    expect(guidedJournal.attempt.assessmentResult()).toEqual(
      liveJournal.attempt.assessmentResult(),
    );

    const brake = (mode: SessionModeView) => {
      const attempt = new GameAttempt({ rootSeed: 4, scenario: quietScenario() });
      const projection = new PublicGameProjection({
        attemptId: 'attempt-brake',
        attempt,
        mode,
        hints: BASELINE_HINT_CONTENT,
      });
      fillJournal(projection);
      const originAt = attempt.scenario.definition.preDeparture.durationUs;
      const dwell = attempt.scenario.definition.originStop?.dwellUs;
      if (dwell === undefined) throw new Error('Origin stop is missing');
      projection.advanceTo(originAt);
      decide(projection, 'passenger-1', 'admit');
      decide(projection, 'passenger-2', 'admit');
      decide(projection, 'passenger-3', 'reject');
      projection.advanceTo(originAt + dwell);
      expect(attempt.phase.kind).toBe('travel');
      attempt.removeEmergencyBrakeSeal();
      attempt.activateEmergencyBrake();
      projection.advanceTo(attempt.time);
      return { hints: hintViews(projection.takePresentationEvents()), attempt };
    };
    const guidedBrake = brake(guided());
    const liveBrake = brake({ kind: 'live' });
    expect(guidedBrake.hints.map((hint) => hint.hintId)).toContain(
      'feedback-false-emergency-brake',
    );
    expect(
      guidedBrake.hints.find((hint) => hint.hintId === 'feedback-false-emergency-brake'),
    ).toMatchObject({
      presentation: 'toast',
      text: hintText('feedback-false-emergency-brake'),
      target: { kind: 'object', objectId: 'emergency-brake' },
    });
    expect(liveBrake.hints).toEqual([]);
    expect(guidedBrake.attempt.assessmentResult()).toEqual(liveBrake.attempt.assessmentResult());
  });

  it('repeats the same hint list for the same seed and does not change scores', () => {
    const first = correctRoute(guided());
    const second = correctRoute(guided());
    const live = correctRoute({ kind: 'live' });
    expect(second.hints).toEqual(first.hints);
    expect(live.hints).toEqual([]);
    expect(first.commands).toEqual(live.commands);
    expect(first.assessment).toEqual(second.assessment);
    expect(first.assessment).toEqual(live.assessment);
    expect(first.hints.length).toBeGreaterThan(0);
  });

  it('rejects hint content that points at a missing object', () => {
    const broken: HintContent = {
      schemaVersion: 1,
      hints: [
        {
          id: 'attempt-start',
          trigger: 'attempt-start',
          role: 'suggestion',
          presentation: 'message',
          text: 'x',
          target: { kind: 'object', objectId: 'missing-journal' },
        },
      ],
    };
    expect(() =>
      loadHintContent(broken, { objectIds: ['acceptance-journal'], actionIds: [] }),
    ).toThrow(/missing object/);
  });
});
