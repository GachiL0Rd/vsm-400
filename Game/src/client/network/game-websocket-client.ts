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
  log?(message: string, detail?: unknown): void;
}

export class GameWebSocketClient {
  private socket: WebSocketLike | null = null;
  private reconnectTimer: number | null = null;
  private reconnecting = false;
  private stopped = true;

  constructor(private readonly options: GameWebSocketClientOptions) {}

  connect(): void {
    this.stopped = false;
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
  }

  reconnect(): void {
    this.disconnect();
    this.connect();
  }

  send(command: ClientCommand): void {
    const parsed = clientCommandSchema.safeParse(command);
    if (!parsed.success) {
      this.options.log?.('Refused invalid client message.', parsed.error.flatten());
      return;
    }
    if (this.socket?.readyState !== 1) {
      this.options.log?.('Refused client message while socket is not open.', command);
      return;
    }
    this.socket.send(JSON.stringify(parsed.data));
  }

  private open(connection: ConnectionState): void {
    this.options.store.setConnection(connection);
    const createSocket = this.options.createSocket ?? ((url: string) => new WebSocket(url));
    const socket = createSocket(this.options.url);
    this.socket = socket;
    socket.onopen = () => {
      if (socket !== this.socket || this.stopped) return;
      this.reconnecting = false;
      this.options.store.setConnection('connected');
      for (const command of this.options.initialCommands?.() ?? []) this.send(command);
    };
    socket.onmessage = (event: MessageEvent<unknown>) => this.receive(event.data);
    socket.onerror = () => this.options.store.setConnection('error');
    socket.onclose = () => {
      if (socket !== this.socket) return;
      this.socket = null;
      if (this.stopped) return;
      this.scheduleReconnect();
    };
  }

  private receive(raw: unknown): void {
    if (typeof raw !== 'string') {
      this.options.log?.('Rejected non-text WebSocket payload.', raw);
      return;
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(raw);
    } catch {
      this.options.log?.('Rejected malformed WebSocket JSON.', raw);
      return;
    }
    const parsed = serverMessageSchema.safeParse(decoded);
    if (!parsed.success) {
      this.options.log?.('Rejected invalid server message.', parsed.error.flatten());
      return;
    }
    this.options.store.apply(parsed.data as ServerMessage);
  }

  private scheduleReconnect(): void {
    this.reconnecting = true;
    this.options.store.setConnection('reconnecting');
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.stopped) this.open(this.reconnecting ? 'reconnecting' : 'connecting');
    }, this.options.reconnectDelayMs ?? 1_000);
  }
}
