import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameConnection, type SocketLike } from './connection';
import type { ObservableSnapshot } from './protocol';

const snapshot: ObservableSnapshot = {
  sessionId: 'demo-1',
  revision: 1,
  simulationTime: 0,
  phase: 'boarding',
  playerZone: 'platform',
  message: 'Начало',
  poi: [],
  npcs: [],
  cues: [],
  tasks: [],
  dialogue: null,
  item: 'stored',
  metrics: null,
  debrief: null,
};

class FakeSocket implements SocketLike {
  readyState = 0;
  sent: unknown[] = [];
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  send(data: string): void {
    this.sent.push(JSON.parse(data) as unknown);
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.({} as Event);
  }
  receive(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent);
  }
  close(): void {
    this.readyState = 3;
    this.onclose?.({} as CloseEvent);
  }
}

afterEach(() => vi.useRealTimers());

describe('WebSocket recovery', () => {
  it('sends a command once while its acknowledgement waits for the matching delta', () => {
    const socket = new FakeSocket();
    const connection = new GameConnection(
      'ws://example.test/game',
      () => {},
      () => socket,
    );
    connection.connect();
    socket.open();
    socket.receive({ type: 'snapshot', protocolVersion: 1, state: snapshot });
    const input = { kind: 'inspect' as const, targetId: 'panel', inspection: 'full' as const };
    expect(connection.sendCommand(input)).toBe('demo-1:1');
    expect(connection.sendCommand(input)).toBeNull();
    expect(
      socket.sent.filter((message) => (message as { type?: string }).type === 'command'),
    ).toHaveLength(1);
    socket.receive({
      type: 'ack',
      protocolVersion: 1,
      sessionId: 'demo-1',
      requestId: 'demo-1:1',
      revision: 2,
    });
    expect(connection.sendCommand(input)).toBeNull();
    expect(connection.getState().snapshot?.revision).toBe(1);
    socket.receive({
      type: 'delta',
      protocolVersion: 1,
      sessionId: 'demo-1',
      revision: 2,
      patch: { item: 'held' },
    });
    expect(connection.getState().pending).toEqual({});
    expect(connection.getState().notice).toBe('Начало');
    expect(connection.sendCommand(input)).toBe('demo-1:4');
    socket.receive({
      type: 'reject',
      protocolVersion: 1,
      sessionId: 'demo-1',
      requestId: 'demo-1:4',
      reason: 'Повторный осмотр недоступен',
    });
    expect(connection.getState().pending).toEqual({});
    expect(connection.getState().notice).toContain('Повторный осмотр недоступен');
    connection.stop();
  });

  it('requests a full state on a sequence gap and resumes from a snapshot', () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    const connection = new GameConnection(
      'ws://example.test/game',
      () => {},
      () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
    );
    connection.connect();
    const first = sockets[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    first.open();
    expect(first.sent[0]).toEqual({ type: 'hello', protocolVersion: 1 });
    first.receive({ type: 'snapshot', protocolVersion: 1, state: snapshot });
    expect(connection.getStatus()).toBe('ready');
    const requestId = connection.sendCommand({
      kind: 'inspect',
      targetId: 'panel',
      inspection: 'full',
    });
    expect(requestId).toBe('demo-1:1');
    first.receive({
      type: 'delta',
      protocolVersion: 1,
      sessionId: 'demo-1',
      revision: 3,
      patch: { item: 'used' },
    });
    expect(connection.getState().snapshot?.item).toBe('stored');
    expect(first.sent.at(-1)).toEqual({
      type: 'resync',
      protocolVersion: 1,
      sessionId: 'demo-1',
      afterRevision: 1,
    });
    expect(connection.sendCommand({ kind: 'finish' })).toBeNull();
    first.receive({ type: 'snapshot', protocolVersion: 1, state: { ...snapshot, revision: 3 } });
    expect(connection.getState().needsResync).toBe(false);

    first.close();
    expect(connection.sendCommand({ kind: 'finish' })).toBeNull();
    vi.advanceTimersByTime(1000);
    const second = sockets[1];
    expect(second).toBeDefined();
    if (second === undefined) return;
    second.open();
    expect(second.sent[0]).toEqual({ type: 'hello', protocolVersion: 1, sessionId: 'demo-1' });
    second.receive({ type: 'snapshot', protocolVersion: 1, state: { ...snapshot, revision: 5 } });
    expect(connection.getStatus()).toBe('ready');
    expect(connection.getState().pending).toEqual({});
    connection.stop();
  });
});
