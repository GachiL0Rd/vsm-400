import { describe, expect, it } from 'vitest';
import { type ClientCommand, GAME_PROTOCOL_VERSION } from '../../common';
import { PresentationStore } from '../presentation/presentation-store';
import { GameWebSocketClient, type WebSocketLike } from './game-websocket-client';

class FakeSocket implements WebSocketLike {
  readyState = 1;
  sent: string[] = [];
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.onclose?.(new CloseEvent('close'));
  }
}

describe('browser transport', () => {
  it('accepts a valid server message and safely rejects an invalid one', () => {
    const sent: ClientCommand[] = [];
    const store = new PresentationStore({
      send: (command) => sent.push(command),
      nextRequestId: () => 'r1',
    });
    const socket = new FakeSocket();
    const client = new GameWebSocketClient({ url: 'ws://test', store, createSocket: () => socket });
    client.connect();
    socket.onopen?.(new Event('open'));
    socket.onmessage?.({
      data: JSON.stringify({
        protocolVersion: GAME_PROTOCOL_VERSION,
        type: 'session-state',
        attemptId: 'a1',
        state: 'active',
      }),
    } as MessageEvent<unknown>);
    socket.onmessage?.({ data: '{oops' } as MessageEvent<unknown>);
    expect(store.snapshot.sessionState?.state).toBe('active');
    expect(sent).toEqual([]);
  });

  it('does not reconnect after an authentication failure or policy close', () => {
    const store = new PresentationStore({ send: () => undefined, nextRequestId: () => 'r1' });
    const sockets: FakeSocket[] = [];
    const client = new GameWebSocketClient({
      url: 'ws://test',
      store,
      reconnectDelayMs: 0,
      createSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
    });
    client.connect();
    const socket = sockets[0];
    if (socket === undefined) throw new Error('Expected socket');
    socket.onopen?.(new Event('open'));
    socket.onmessage?.({
      data: JSON.stringify({
        protocolVersion: GAME_PROTOCOL_VERSION,
        type: 'error',
        requestId: 'hello-1',
        code: 'authentication-failed',
        message: 'bad key',
      }),
    } as MessageEvent<unknown>);
    socket.onclose?.({ code: 1008 } as CloseEvent);

    expect(store.snapshot.connection).toBe('error');
    expect(sockets).toHaveLength(1);
  });

  it('traces movement results without recording session credentials', () => {
    const store = new PresentationStore({ send: () => undefined, nextRequestId: () => 'r1' });
    const socket = new FakeSocket();
    const entries: Record<string, unknown>[] = [];
    const client = new GameWebSocketClient({
      url: 'ws://test',
      store,
      createSocket: () => socket,
      initialCommands: () => [
        {
          protocolVersion: GAME_PROTOCOL_VERSION,
          type: 'hello',
          requestId: 'hello-1',
          sessionKey: 'secret-session-key',
        },
      ],
      trace: (entry) => entries.push(entry),
    });
    client.connect();
    socket.onopen?.(new Event('open'));
    socket.onmessage?.({
      data: JSON.stringify({
        protocolVersion: GAME_PROTOCOL_VERSION,
        type: 'session-ready',
        attemptId: 'a1',
        resumeToken: 'secret-resume-token',
        snapshot: {
          protocolVersion: GAME_PROTOCOL_VERSION,
          type: 'snapshot',
          state: {
            attemptId: 'a1',
            revision: 0,
            timeUs: 0,
            clock: { timeScale: 1, paused: false },
            mode: { kind: 'live' },
            phase: { kind: 'pre-departure' },
            termination: null,
            activeRegionIds: [],
            world: { regions: [], cells: [], edges: [], objects: [] },
            entities: [],
          },
        },
      }),
    } as MessageEvent<unknown>);
    client.send({
      protocolVersion: GAME_PROTOCOL_VERSION,
      type: 'move-to',
      requestId: 'move-1',
      knownRevision: 0,
      targetCellId: 'door',
    });
    socket.onmessage?.({
      data: JSON.stringify({
        protocolVersion: GAME_PROTOCOL_VERSION,
        type: 'command-result',
        requestId: 'move-1',
        status: 'rejected',
        code: 'action-rejected',
        message: 'Target cell is not directly reachable',
        revision: 0,
      }),
    } as MessageEvent<unknown>);

    expect(entries).toContainEqual({
      direction: 'out',
      type: 'move-to',
      requestId: 'move-1',
      knownRevision: 0,
      targetCellId: 'door',
    });
    expect(entries).toContainEqual({
      direction: 'in',
      type: 'command-result',
      requestId: 'move-1',
      status: 'rejected',
      code: 'action-rejected',
      message: 'Target cell is not directly reachable',
      revision: 0,
    });
    expect(JSON.stringify(entries)).not.toContain('secret-');
  });
});
