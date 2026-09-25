import {
  type ActionKind,
  type ClientMessage,
  PROTOCOL_VERSION,
  parseServerMessage,
  type ZoneId,
} from './protocol';
import { applyServerMessage, type ClientState, createClientState, queueCommand } from './state';

export type ConnectionStatus =
  | 'connecting'
  | 'ready'
  | 'temporarily disconnected'
  | 'reconnecting'
  | 'failed';

export interface SocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
}

export interface CommandInput {
  kind: ActionKind;
  targetId?: string;
  optionId?: string;
  zoneId?: ZoneId;
  inspection?: 'quick' | 'full';
  speed?: 0 | 1 | 3;
}

export class GameConnection {
  private socket: SocketLike | null = null;
  private state: ClientState = createClientState();
  private status: ConnectionStatus = 'connecting';
  private attempts = 0;
  private requestNumber = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private onChange: (state: ClientState, status: ConnectionStatus) => void;

  constructor(
    private readonly url: string,
    onChange: (state: ClientState, status: ConnectionStatus) => void,
    private readonly socketFactory: (url: string) => SocketLike = (address) =>
      new WebSocket(address),
  ) {
    this.onChange = onChange;
  }

  getState(): ClientState {
    return this.state;
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  connect(): void {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.attempts = 0;
    this.stopped = false;
    const previous = this.socket;
    this.socket = null;
    previous?.close();
    this.openSocket();
  }

  stop(): void {
    this.stopped = true;
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const previous = this.socket;
    this.socket = null;
    previous?.close();
  }

  sendCommand(input: CommandInput): string | null {
    const snapshot = this.state.snapshot;
    if (this.status !== 'ready' || snapshot === null || this.state.needsResync) return null;
    const requestId = `${snapshot.sessionId}:${++this.requestNumber}`;
    const command: ClientMessage & { type: 'command' } = {
      type: 'command',
      protocolVersion: PROTOCOL_VERSION,
      sessionId: snapshot.sessionId,
      requestId,
      baseRevision: snapshot.revision,
      ...input,
    };
    const queued = queueCommand(this.state, command);
    if (queued === this.state) return null;
    this.state = queued;
    this.publish();
    this.send(command);
    return requestId;
  }

  requestResync(): void {
    const snapshot = this.state.snapshot;
    if (snapshot === null || this.socket?.readyState !== 1) return;
    this.send({
      type: 'resync',
      protocolVersion: PROTOCOL_VERSION,
      sessionId: snapshot.sessionId,
      afterRevision: snapshot.revision,
    });
  }

  private openSocket(): void {
    if (this.stopped) return;
    this.status = this.attempts === 0 ? 'connecting' : 'reconnecting';
    this.publish();
    let socket: SocketLike;
    try {
      socket = this.socketFactory(this.url);
    } catch {
      this.scheduleRetry();
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      if (socket !== this.socket || this.stopped) return;
      this.attempts = 0;
      this.status = 'connecting';
      const sessionId = this.state.snapshot?.sessionId;
      this.send({
        type: 'hello',
        protocolVersion: PROTOCOL_VERSION,
        ...(sessionId === undefined ? {} : { sessionId }),
      });
      this.publish();
    };
    socket.onmessage = (event) => {
      if (socket !== this.socket || typeof event.data !== 'string') return;
      try {
        const message = parseServerMessage(event.data);
        this.state = applyServerMessage(this.state, message);
        if (message.type === 'snapshot') this.status = 'ready';
        if (this.state.needsResync) this.requestResync();
        this.publish();
      } catch {
        this.state = {
          ...this.state,
          notice: 'Ошибка данных. Обновляем состояние.',
          needsResync: true,
        };
        this.requestResync();
        this.publish();
      }
    };
    socket.onclose = () => {
      if (socket !== this.socket || this.stopped) return;
      this.socket = null;
      this.status = 'temporarily disconnected';
      this.state = {
        ...this.state,
        pending: {},
        notice: 'Связь потеряна. Действия временно недоступны.',
      };
      this.publish();
      this.scheduleRetry();
    };
    socket.onerror = () => {
      if (socket !== this.socket) return;
      socket.close();
    };
  }

  private scheduleRetry(): void {
    if (this.stopped) return;
    this.attempts += 1;
    if (this.attempts > 8) {
      this.status = 'failed';
      this.publish();
      return;
    }
    this.status = 'reconnecting';
    this.publish();
    this.retryTimer = setTimeout(
      () => {
        this.retryTimer = null;
        this.openSocket();
      },
      Math.min(1000 * 2 ** (this.attempts - 1), 8000),
    );
  }

  private send(message: ClientMessage): void {
    if (this.socket?.readyState === 1) this.socket.send(JSON.stringify(message));
  }

  private publish(): void {
    this.onChange(this.state, this.status);
  }
}
