import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type ClientCommand,
  GAME_PROTOCOL_VERSION,
  gameSnapshotSchema,
  type PresentationEventMessage,
  type ServerMessage,
} from '../../common';
import {
  achievementTitle,
  formatSimClock,
  PRESENTATION_LOG_LIMIT,
  PRESENTATION_TOAST_LIMIT,
  rejectionCopy,
  SPEECH_TTL_MS,
  TOAST_TTL_MS,
} from './presentation-copy';
import { PresentationStore } from './presentation-store';

const snapshot = (revision = 1, attemptId = 'attempt-1') =>
  gameSnapshotSchema.parse({
    protocolVersion: GAME_PROTOCOL_VERSION,
    type: 'snapshot',
    state: {
      attemptId,
      revision,
      timeUs: 10,
      clock: { timeScale: 1, paused: false },
      mode: { kind: 'live' },
      phase: { kind: 'pre-departure' },
      termination: null,
      activeRegionIds: ['car-1'],
      world: {
        regions: [{ id: 'car-1' }],
        cells: [{ id: 'cell-1', x: 0, y: 0, regionId: 'car-1' }],
        edges: [],
        objects: [],
      },
      entities: [
        {
          id: 'player-1',
          kind: 'player',
          appearanceId: 'conductor',
          position: { kind: 'cell', cellId: 'cell-1' },
        },
      ],
    },
  });

describe('PresentationStore', () => {
  it('replaces the public copy with a snapshot and applies a valid delta', () => {
    const sent: ClientCommand[] = [];
    const store = new PresentationStore({
      send: (command) => sent.push(command),
      nextRequestId: () => 'resync-1',
    });
    store.apply(snapshot());
    store.apply({
      protocolVersion: GAME_PROTOCOL_VERSION,
      type: 'delta',
      attemptId: 'attempt-1',
      baseRevision: 1,
      revision: 2,
      changes: {
        timeUs: 20,
        entities: {
          removeIds: [],
          upsert: [
            {
              id: 'passenger-1',
              kind: 'passenger',
              appearanceId: 'p',
              position: { kind: 'cell', cellId: 'cell-1' },
            },
          ],
        },
      },
    });
    expect(store.snapshot.publicState?.timeUs).toBe(20);
    expect(store.snapshot.publicState?.entities.map((entity) => entity.id)).toEqual([
      'player-1',
      'passenger-1',
    ]);
    expect(sent).toEqual([]);
  });

  it('requests resync rather than repairing a delta with the wrong base revision', () => {
    const sent: ClientCommand[] = [];
    const store = new PresentationStore({
      send: (command) => sent.push(command),
      nextRequestId: () => 'resync-1',
    });
    store.apply(snapshot());
    store.apply({
      protocolVersion: GAME_PROTOCOL_VERSION,
      type: 'delta',
      attemptId: 'attempt-1',
      baseRevision: 99,
      revision: 100,
      changes: { timeUs: 20 },
    });
    expect(store.snapshot.revision).toBe(1);
    expect(sent).toEqual([
      { protocolVersion: 1, type: 'resync', requestId: 'resync-1', knownRevision: 1 },
    ]);
  });

  it('replaces an existing entity on upsert instead of duplicating it', () => {
    const store = new PresentationStore({ send: () => undefined, nextRequestId: () => 'unused' });
    store.apply(snapshot());
    store.apply({
      protocolVersion: GAME_PROTOCOL_VERSION,
      type: 'delta',
      attemptId: 'attempt-1',
      baseRevision: 1,
      revision: 2,
      changes: {
        entities: {
          removeIds: [],
          upsert: [
            {
              id: 'player-1',
              kind: 'player',
              appearanceId: 'conductor',
              position: { kind: 'cell', cellId: 'cell-2' },
            },
          ],
        },
      },
    });

    expect(store.snapshot.publicState?.entities).toHaveLength(1);
    expect(store.snapshot.publicState?.entities[0]?.position).toEqual({
      kind: 'cell',
      cellId: 'cell-2',
    });
  });

  it('requests resync when the server rejects a command as stale', () => {
    const sent: ClientCommand[] = [];
    const store = new PresentationStore({
      send: (command) => sent.push(command),
      nextRequestId: () => 'resync-stale',
    });
    store.apply(snapshot());
    store.apply({
      protocolVersion: GAME_PROTOCOL_VERSION,
      type: 'command-result',
      requestId: 'move-old',
      status: 'rejected',
      revision: 2,
      code: 'stale-revision',
      message: 'stale-revision',
    });

    expect(sent).toEqual([
      { protocolVersion: 1, type: 'resync', requestId: 'resync-stale', knownRevision: 1 },
    ]);
  });

  it('keeps an offer only for the current revision and clears it on the next revision', () => {
    const store = new PresentationStore({ send: () => undefined, nextRequestId: () => 'unused' });
    store.apply(snapshot());
    store.apply({
      protocolVersion: GAME_PROTOCOL_VERSION,
      type: 'action-offer',
      requestId: 'query-1',
      revision: 1,
      target: { kind: 'entity', entityId: 'player-1' },
      actions: [
        {
          handle: 'inspect-1',
          uiKind: 'inspect',
          label: 'Inspect',
          target: { kind: 'entity', entityId: 'player-1' },
        },
      ],
    });
    expect(store.snapshot.currentOffer?.actions[0]?.handle).toBe('inspect-1');
    store.apply({
      protocolVersion: GAME_PROTOCOL_VERSION,
      type: 'delta',
      attemptId: 'attempt-1',
      baseRevision: 1,
      revision: 2,
      changes: {},
    });
    expect(store.snapshot.currentOffer).toBeNull();
  });
});

const storeWith = (): PresentationStore =>
  new PresentationStore({ send: () => undefined, nextRequestId: () => 'unused' });

const speech = (
  sequence: number,
  entityId = 'passenger-1',
  text = 'Можно воды?',
  visible = true,
  attemptId = 'attempt-1',
): PresentationEventMessage => ({
  protocolVersion: GAME_PROTOCOL_VERSION,
  type: 'presentation-event',
  attemptId,
  at: 12_500_000,
  sequence,
  event: { kind: 'speech', entityId, text, visible },
});

const notification = (sequence: number, text = `Сигнал ${sequence}`): PresentationEventMessage => ({
  protocolVersion: GAME_PROTOCOL_VERSION,
  type: 'presentation-event',
  attemptId: 'attempt-1',
  at: 65_000_000,
  sequence,
  event: { kind: 'notification', notificationId: `note-${sequence}`, text },
});

const session = (
  state: Extract<ServerMessage, { type: 'session-state' }>['state'],
  attemptId = 'attempt-1',
  redirectUrl?: string,
): Extract<ServerMessage, { type: 'session-state' }> => ({
  protocolVersion: GAME_PROTOCOL_VERSION,
  type: 'session-state',
  attemptId,
  state,
  ...(redirectUrl === undefined ? {} : { redirectUrl }),
});

describe('PresentationStore presentation feed', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('routes speech into the dialog and the observation feed', () => {
    const store = storeWith();
    store.apply(snapshot());
    store.apply(speech(1, 'player-1', 'Проверка связи'));
    expect(store.snapshot.dialog).toEqual({
      kind: 'speech',
      speaker: 'Проводник',
      text: 'Проверка связи',
    });
    expect(store.snapshot.observations[0]).toMatchObject({
      speaker: 'Проводник',
      text: 'Проверка связи',
      atUs: 12_500_000,
    });
    expect(formatSimClock(12_500_000)).toBe('00:12');

    store.apply(speech(2));
    expect(store.snapshot.observations.map((entry) => entry.speaker)).toEqual([
      'Пассажир',
      'Проводник',
    ]);
  });

  it('dedupes presentation events by sequence and accepts the same sequence after resync', () => {
    const store = storeWith();
    store.apply(snapshot());
    store.apply(speech(4, 'passenger-1', 'Первый'));
    store.apply(speech(4, 'passenger-1', 'Повтор'));
    expect(store.snapshot.observations).toHaveLength(1);
    expect(store.snapshot.observations[0]?.text).toBe('Первый');

    store.apply(speech(4, 'passenger-1', 'Чужой', true, 'attempt-other'));
    expect(store.snapshot.observations).toHaveLength(1);

    store.apply(snapshot(2));
    expect(store.snapshot.observations).toEqual([]);
    store.apply(speech(4, 'passenger-1', 'После снимка'));
    expect(store.snapshot.observations.map((entry) => entry.text)).toEqual(['После снимка']);
  });

  it('keeps observation and event logs bounded, newest first', () => {
    const store = storeWith();
    store.apply(snapshot());
    for (let sequence = 0; sequence < PRESENTATION_LOG_LIMIT + 5; sequence += 1) {
      store.apply(speech(sequence, 'passenger-1', `реплика ${sequence}`));
      store.apply(notification(1_000 + sequence, `событие ${sequence}`));
    }
    expect(store.snapshot.observations).toHaveLength(PRESENTATION_LOG_LIMIT);
    expect(store.snapshot.events).toHaveLength(PRESENTATION_LOG_LIMIT);
    expect(store.snapshot.observations[0]?.text).toBe(`реплика ${PRESENTATION_LOG_LIMIT + 4}`);
    expect(store.snapshot.events[0]?.text).toBe(`событие ${PRESENTATION_LOG_LIMIT + 4}`);
  });

  it('hides speech after six seconds unless an action offer is open', () => {
    vi.useFakeTimers();
    const store = storeWith();
    store.apply(snapshot());
    store.apply(speech(1));
    vi.advanceTimersByTime(SPEECH_TTL_MS - 1);
    expect(store.snapshot.dialog?.text).toBe('Можно воды?');
    vi.advanceTimersByTime(1);
    expect(store.snapshot.dialog).toBeNull();

    store.apply(speech(2));
    store.apply({
      protocolVersion: GAME_PROTOCOL_VERSION,
      type: 'action-offer',
      requestId: 'query-1',
      revision: 1,
      target: { kind: 'entity', entityId: 'player-1' },
      actions: [
        {
          handle: 'talk-1',
          uiKind: 'dialogue',
          label: 'Ответить',
          target: { kind: 'entity', entityId: 'player-1' },
        },
      ],
    });
    vi.advanceTimersByTime(SPEECH_TTL_MS + 1_000);
    expect(store.snapshot.dialog?.text).toBe('Можно воды?');
    store.clearActionOffer();
    vi.advanceTimersByTime(SPEECH_TTL_MS - 1);
    expect(store.snapshot.dialog).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(store.snapshot.dialog).toBeNull();
  });

  it('routes hints, ignores highlight and effect, and drops hidden speech', () => {
    const logged: string[] = [];
    const store = new PresentationStore({
      send: () => undefined,
      nextRequestId: () => 'unused',
      log: (message) => logged.push(message),
    });
    store.apply(snapshot());
    store.apply({
      protocolVersion: GAME_PROTOCOL_VERSION,
      type: 'presentation-event',
      attemptId: 'attempt-1',
      at: 1,
      sequence: 1,
      event: { kind: 'hint', hintId: 'hint-1', presentation: 'message', text: 'Проверьте журнал' },
    });
    expect(store.snapshot.dialog).toEqual({
      kind: 'hint',
      speaker: null,
      text: 'Проверьте журнал',
    });
    expect(store.snapshot.toasts).toEqual([]);

    store.apply({
      protocolVersion: GAME_PROTOCOL_VERSION,
      type: 'presentation-event',
      attemptId: 'attempt-1',
      at: 2,
      sequence: 2,
      event: { kind: 'hint', hintId: 'hint-2', presentation: 'toast', text: 'Дым' },
    });
    expect(store.snapshot.toasts[0]?.text).toBe('Дым');

    store.apply({
      protocolVersion: GAME_PROTOCOL_VERSION,
      type: 'presentation-event',
      attemptId: 'attempt-1',
      at: 3,
      sequence: 3,
      event: { kind: 'hint', hintId: 'hint-3', presentation: 'highlight' },
    });
    store.apply({
      protocolVersion: GAME_PROTOCOL_VERSION,
      type: 'presentation-event',
      attemptId: 'attempt-1',
      at: 4,
      sequence: 4,
      event: { kind: 'effect', effectId: 'fx-1', visualId: 'fx.smoke' },
    });
    expect(logged).toEqual(['Presentation highlight ignored.', 'Presentation effect ignored.']);
    store.apply(speech(5, 'passenger-1', 'Тихо', false));
    expect(store.snapshot.observations).toEqual([]);
    expect(store.snapshot.dialog?.kind).toBe('hint');
    store.apply(speech(6));
    store.apply(speech(7, 'passenger-1', 'Скрыто', false));
    expect(store.snapshot.dialog).toBeNull();
    expect(store.snapshot.observations.map((entry) => entry.text)).toEqual(['Можно воды?']);
  });

  it('expires toasts, pauses them, and shows the queued fourth toast', () => {
    vi.useFakeTimers();
    const store = storeWith();
    store.apply(snapshot());
    for (let sequence = 0; sequence < PRESENTATION_TOAST_LIMIT + 1; sequence += 1) {
      store.apply(notification(sequence));
    }
    expect(store.snapshot.toasts).toHaveLength(PRESENTATION_TOAST_LIMIT);
    expect(store.snapshot.toasts.map((toast) => toast.text)).toEqual([
      'Сигнал 0',
      'Сигнал 1',
      'Сигнал 2',
    ]);
    const held = store.snapshot.toasts[0];
    if (held === undefined) throw new Error('Expected a visible toast');
    vi.advanceTimersByTime(1_000);
    store.pauseToast(held.id);
    vi.advanceTimersByTime(TOAST_TTL_MS);
    expect(store.snapshot.toasts.map((toast) => toast.text)).toEqual(['Сигнал 0', 'Сигнал 3']);
    store.resumeToast(held.id);
    vi.advanceTimersByTime(TOAST_TTL_MS - 1_000 - 1);
    expect(store.snapshot.toasts.map((toast) => toast.text)).toEqual(['Сигнал 0', 'Сигнал 3']);
    vi.advanceTimersByTime(1);
    expect(store.snapshot.toasts).toEqual([]);
  });

  it('maps achievements, including an unknown id', () => {
    const store = storeWith();
    store.apply(snapshot());
    store.apply({
      protocolVersion: GAME_PROTOCOL_VERSION,
      type: 'presentation-event',
      attemptId: 'attempt-1',
      at: 3_000_000,
      sequence: 1,
      event: { kind: 'achievement-unlocked', achievementId: 'documents-perfect' },
    });
    store.apply({
      protocolVersion: GAME_PROTOCOL_VERSION,
      type: 'presentation-event',
      attemptId: 'attempt-1',
      at: 4_000_000,
      sequence: 2,
      event: { kind: 'achievement-unlocked', achievementId: 'not-in-dictionary' },
    });
    expect(store.snapshot.toasts.map((toast) => toast.variant)).toEqual([
      'achievement',
      'achievement',
    ]);
    expect(store.snapshot.toasts.map((toast) => toast.text)).toEqual([
      'Документы без ошибок',
      'Достижение получено',
    ]);
    expect(achievementTitle('documents-perfect')).toBe('Документы без ошибок');
    expect(achievementTitle('fast-fire-response')).toBe('Быстрая реакция на пожар');
    expect(achievementTitle('safe-emergency-stop')).toBe('Безопасная остановка');
    expect(achievementTitle('all-service-requests-resolved')).toBe('Все запросы выполнены');
    expect(achievementTitle('clean-predeparture')).toBe('Чистая приёмка');
    expect(achievementTitle('missing')).toBe('Достижение получено');
  });

  it('shows a protocol error in the event feed and as a toast', () => {
    const store = storeWith();
    store.apply(snapshot());
    store.apply({
      protocolVersion: GAME_PROTOCOL_VERSION,
      type: 'error',
      requestId: 'req-9',
      code: 'invalid-message',
      message: 'Некорректное сообщение',
    });
    expect(store.snapshot.connection).toBe('error');
    expect(store.snapshot.lastError?.message).toBe('Некорректное сообщение');
    expect(store.snapshot.events[0]?.text).toBe('Некорректное сообщение');
    expect(store.snapshot.toasts.map((toast) => toast.text)).toEqual(['Некорректное сообщение']);
  });

  it('records session-state transitions and clears them on a new attempt', () => {
    const store = storeWith();
    store.apply(snapshot());
    for (const state of ['active', 'paused', 'finishing', 'aborted'] as const) {
      store.apply(session(state));
      expect(store.snapshot.sessionState?.state).toBe(state);
    }
    store.apply(session('finished', 'attempt-1', 'https://platform.example/results/1'));
    expect(store.snapshot.sessionState).toMatchObject({
      state: 'finished',
      redirectUrl: 'https://platform.example/results/1',
    });
    store.apply(snapshot(3));
    expect(store.snapshot.sessionState?.state).toBe('finished');
    store.apply(snapshot(1, 'attempt-2'));
    expect(store.snapshot.sessionState).toBeNull();
  });

  it('records phase changes and Russian text for rejected commands', () => {
    const sent: ClientCommand[] = [];
    const store = new PresentationStore({
      send: (command) => sent.push(command),
      nextRequestId: () => 'resync-reject',
    });
    store.apply(snapshot());
    expect(store.snapshot.events[0]?.text).toBe('Фаза: Приёмка вагона');
    store.apply({
      protocolVersion: GAME_PROTOCOL_VERSION,
      type: 'delta',
      attemptId: 'attempt-1',
      baseRevision: 1,
      revision: 2,
      changes: { phase: { kind: 'origin-stop' } },
    });
    expect(store.snapshot.events[0]?.text).toBe('Фаза: Посадка');

    store.apply({
      protocolVersion: GAME_PROTOCOL_VERSION,
      type: 'command-result',
      requestId: 'bad-action',
      status: 'rejected',
      revision: 2,
      code: 'action-rejected',
      message: 'action-rejected',
    });
    store.apply({
      protocolVersion: GAME_PROTOCOL_VERSION,
      type: 'command-result',
      requestId: 'bad-command',
      status: 'rejected',
      revision: 2,
      code: 'unsupported-command',
      message: 'unsupported-command',
    });
    store.apply({
      protocolVersion: GAME_PROTOCOL_VERSION,
      type: 'command-result',
      requestId: 'bad-input',
      status: 'rejected',
      revision: 2,
      code: 'invalid-input',
      message: 'Поле не заполнено',
    });
    expect(store.snapshot.events.slice(0, 3).map((entry) => entry.text)).toEqual([
      'Поле не заполнено',
      'Команда не поддерживается.',
      'Действие сейчас недоступно.',
    ]);
    expect(store.snapshot.toasts.map((toast) => toast.text)).toEqual([
      'Действие сейчас недоступно.',
      'Команда не поддерживается.',
      'Поле не заполнено',
    ]);

    store.apply({
      protocolVersion: GAME_PROTOCOL_VERSION,
      type: 'command-result',
      requestId: 'stale',
      status: 'rejected',
      revision: 2,
      code: 'stale-revision',
      message: 'stale-revision',
    });
    expect(store.snapshot.toasts).toHaveLength(3);
    expect(store.snapshot.events.some((entry) => entry.text.includes('stale'))).toBe(false);
    expect(sent).toEqual([
      { protocolVersion: 1, type: 'resync', requestId: 'resync-reject', knownRevision: 2 },
    ]);
    expect(rejectionCopy('invalid-target', 'ignored')).toBe('Эта цель недоступна.');
    expect(rejectionCopy('stale-revision', 'stale-revision')).toBeNull();
    expect(rejectionCopy('future-code', 'Сервер отказал')).toBe('Сервер отказал');
  });
});
