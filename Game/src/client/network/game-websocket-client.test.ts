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
});
