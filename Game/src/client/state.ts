import type { ClientMessage, ObservableSnapshot, ServerMessage } from './protocol';

interface PendingCommand {
  command: ClientMessage & { type: 'command' };
  acknowledgedAt?: number;
}

export interface ClientState {
  snapshot: ObservableSnapshot | null;
  snapshotSerial: number;
  pending: Readonly<Record<string, PendingCommand>>;
  notice: string;
  needsResync: boolean;
}

export function createClientState(): ClientState {
  return { snapshot: null, snapshotSerial: 0, pending: {}, notice: '', needsResync: false };
}

export function queueCommand(
  state: ClientState,
  command: ClientMessage & { type: 'command' },
): ClientState {
  if (state.snapshot?.sessionId !== command.sessionId || state.needsResync) return state;
  const duplicate = Object.values(state.pending).some(
    ({ command: existing }) =>
      existing.kind === command.kind &&
      existing.targetId === command.targetId &&
      existing.optionId === command.optionId &&
      existing.zoneId === command.zoneId &&
      existing.inspection === command.inspection &&
      existing.speed === command.speed,
  );
  if (duplicate) return state;
  return {
    ...state,
    pending: { ...state.pending, [command.requestId]: { command } },
    notice: 'Ожидание ответа сервера…',
  };
}

export function applyServerMessage(state: ClientState, message: ServerMessage): ClientState {
  if (message.type === 'snapshot') {
    return {
      snapshot: message.state,
      snapshotSerial: state.snapshotSerial + 1,
      pending: {},
      notice: message.state.message,
      needsResync: false,
    };
  }

  const current = state.snapshot;
  if (current === null) {
    return { ...state, needsResync: true, notice: 'Синхронизация с сервером…' };
  }
  if (message.sessionId !== current.sessionId) return state;

  if (message.type === 'delta') {
    if (message.revision <= current.revision) return state;
    if (message.revision !== current.revision + 1) {
      return { ...state, needsResync: true, notice: 'Пропуск данных. Обновляем состояние.' };
    }
    const pending = Object.fromEntries(
      Object.entries(state.pending).filter(
        ([, value]) =>
          value.acknowledgedAt === undefined || value.acknowledgedAt > message.revision,
      ),
    );
    return {
      ...state,
      snapshot: { ...current, ...message.patch, revision: message.revision },
      pending,
      notice:
        message.patch.message ?? (Object.keys(pending).length > 0 ? state.notice : current.message),
      needsResync: false,
    };
  }

  const pendingCommand = state.pending[message.requestId];
  if (pendingCommand === undefined) return state;
  if (message.type === 'reject') {
    const pending = { ...state.pending };
    delete pending[message.requestId];
    return { ...state, pending, notice: `Действие отклонено: ${message.reason}` };
  }
  if (message.revision <= current.revision) {
    const pending = { ...state.pending };
    delete pending[message.requestId];
    return { ...state, pending, notice: 'Действие подтверждено.' };
  }
  return {
    ...state,
    pending: {
      ...state.pending,
      [message.requestId]: { ...pendingCommand, acknowledgedAt: message.revision },
    },
    notice: 'Действие подтверждено. Ожидаем обновление…',
  };
}
