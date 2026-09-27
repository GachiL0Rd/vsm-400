import {
  type ClientCommand,
  clientCommandSchema,
  type ServerMessage,
  serverMessageSchema,
} from '../../common';
import type { ConnectionState, PresentationStore } from '../presentation/presentation-store';

export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((event: Event) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
}

export interface GameWebSocketClientOptions {
  url: string;
  store: PresentationStore;
  createSocket?(url: string): WebSocketLike;
  initialCommands?(): readonly ClientCommand[];
  reconnectDelayMs?: number;
  onServerMessage?(message: ServerMessage): void;
  log?(message: string, detail?: unknown): void;
  trace?(entry: Record<string, unknown>): void;
}

export class GameWebSocketClient {
  private socket: WebSocketLike | null = null;
  private reconnectTimer: number | null = null;
  private reconnecting = false;
  private stopped = true;
  private reconnectBlocked = false;
  private authenticated = false;
  private connectionAttempt = 0;

  constructor(private readonly options: GameWebSocketClientOptions) {}

  connect(): void {
    this.stopped = false;
    this.reconnectBlocked = false;
    this.options.trace?.({ direction: 'connection', state: 'connecting' });
    this.open('connecting');
  }

  disconnect(): void {
    this.stopped = true;
    this.reconnecting = false;
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.socket?.close();
    this.socket = null;
    this.options.store.setConnection('disconnected');
    this.options.trace?.({ direction: 'connection', state: 'disconnected' });
  }

  reconnect(): void {
    this.disconnect();
    this.connect();
  }

  send(command: ClientCommand): void {
    const parsed = clientCommandSchema.safeParse(command);
    if (!parsed.success) {
      this.options.log?.('Refused invalid client message.', {
        type: command.type,
        requestId: command.requestId,
        issueCount: parsed.error.issues.length,
      });
      return;
    }
    if (this.socket?.readyState !== 1) {
      this.options.log?.('Refused client message while socket is not open.', {
        type: command.type,
        requestId: command.requestId,
        readyState: this.socket?.readyState ?? null,
      });
      return;
    }
    if (!this.authenticated && command.type !== 'hello') {
      this.options.log?.('Refused command before session-ready.', command.type);
      return;
    }
    this.socket.send(JSON.stringify(parsed.data));
    this.options.trace?.(outgoingTrace(parsed.data));
  }

  private open(connection: ConnectionState): void {
    this.authenticated = false;
    this.connectionAttempt += 1;
    this.options.trace?.({
      direction: 'connection',
      state: connection,
      attempt: this.connectionAttempt,
    });
    this.options.store.setConnection(connection);
    const createSocket = this.options.createSocket ?? ((url: string) => new WebSocket(url));
    const socket = createSocket(this.options.url);
    this.socket = socket;
    socket.onopen = () => {
      if (socket !== this.socket || this.stopped) return;
      this.reconnecting = false;
      this.options.trace?.({ direction: 'connection', state: 'open' });
      for (const command of this.options.initialCommands?.() ?? []) this.send(command);
    };
    socket.onmessage = (event: MessageEvent<unknown>) => {
      if (socket === this.socket) this.receive(event.data);
    };
    socket.onerror = () => {
      if (socket === this.socket) {
        this.options.trace?.({ direction: 'connection', state: 'error' });
        this.options.store.setConnection('error');
      }
    };
    socket.onclose = (event) => {
      if (socket !== this.socket) return;
      this.options.trace?.({ direction: 'connection', state: 'closed', code: event.code });
      this.socket = null;
      this.authenticated = false;
      if (this.stopped) return;
      if (this.reconnectBlocked || isPolicyClose(event)) {
        this.reconnectBlocked = true;
        this.options.store.setConnection('error');
        return;
      }
      this.scheduleReconnect();
    };
  }

  private receive(raw: unknown): void {
    if (typeof raw !== 'string') {
      this.options.log?.('Rejected non-text WebSocket payload.', { payloadType: typeof raw });
      return;
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(raw);
    } catch {
      this.options.log?.('Rejected malformed WebSocket JSON.', { length: raw.length });
      return;
    }
    const parsed = serverMessageSchema.safeParse(decoded);
    if (!parsed.success) {
      this.options.log?.('Rejected invalid server message.', {
        issueCount: parsed.error.issues.length,
      });
      return;
    }
    const message = parsed.data as ServerMessage;
    const trace = incomingTrace(message);
    if (trace !== null) this.options.trace?.(trace);
    if (isTerminalProtocolError(message)) this.reconnectBlocked = true;
    this.options.onServerMessage?.(message);
    this.options.store.apply(message);
    if (message.type === 'session-ready') {
      this.authenticated = true;
      this.options.store.setConnection('connected');
    }
  }

  private scheduleReconnect(): void {
    this.reconnecting = true;
    this.options.trace?.({ direction: 'connection', state: 'reconnecting' });
    this.options.store.setConnection('reconnecting');
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.stopped) this.open(this.reconnecting ? 'reconnecting' : 'connecting');
    }, this.options.reconnectDelayMs ?? 1_000);
  }
}

function outgoingTrace(command: ClientCommand): Record<string, unknown> {
  const entry: Record<string, unknown> = {
    direction: 'out',
    type: command.type,
    requestId: command.requestId,
  };
  if ('knownRevision' in command) entry.knownRevision = command.knownRevision;
  if (command.type === 'move-to') entry.targetCellId = command.targetCellId;
  if (command.type === 'query-actions') entry.target = command.target;
  if (command.type === 'invoke-action') entry.actionHandle = command.actionHandle;
  if (command.type === 'set-time-scale') entry.scale = command.scale;
  // hello credentials and action form input must never enter browser diagnostics.
  return entry;
}

function incomingTrace(message: ServerMessage): Record<string, unknown> | null {
  const entry: Record<string, unknown> = { direction: 'in', type: message.type };
  if ('requestId' in message) entry.requestId = message.requestId;
  switch (message.type) {
    case 'session-ready':
    case 'snapshot': {
      const state = message.type === 'session-ready' ? message.snapshot.state : message.state;
      entry.revision = state.revision;
      entry.playerPosition = state.entities.find((entity) => entity.kind === 'player')?.position;
      return entry;
    }
    case 'delta': {
      const player = message.changes.entities?.upsert.find((entity) => entity.kind === 'player');
      entry.baseRevision = message.baseRevision;
      entry.revision = message.revision;
      entry.changeKeys = Object.keys(message.changes);
      if (message.changes.timeUs !== undefined) entry.timeUs = message.changes.timeUs;
      if (message.changes.entities !== undefined) {
        entry.upsertEntityIds = message.changes.entities.upsert.map((entity) => entity.id);
        entry.removedEntityIds = message.changes.entities.removeIds;
      }
      if (player !== undefined) entry.playerPosition = player.position;
      return entry;
    }
    case 'command-result':
      entry.status = message.status;
      if (message.status === 'rejected') {
        entry.code = message.code;
        entry.message = message.message;
      }
      entry.revision = message.revision;
      return entry;
    case 'action-offer':
      entry.revision = message.revision;
      entry.target = message.target;
      entry.actionCount = message.actions.length;
      return entry;
    case 'error':
      entry.code = message.code;
      entry.message = message.message;
      return entry;
    case 'presentation-event':
      entry.eventKind = message.event.kind;
      return entry;
    case 'session-state':
      entry.state = message.state;
      return entry;
    default:
      return entry;
  }
}

function isPolicyClose(event: CloseEvent): boolean {
  return event.code === 1007 || event.code === 1008;
}

function isTerminalProtocolError(message: ServerMessage): boolean {
  if (message.type !== 'error') return false;
  return new Set([
    'authentication-failed',
    'invalid-hello',
    'already-authenticated',
    'invalid-message',
  ]).has(message.code);
}
