import { describe, expect, it } from 'vitest';
import {
  GAME_PROTOCOL_VERSION,
  type ServerMessage,
  serverMessageSchema,
} from '../common/game-wire.ts';
import { BaselineContentRegistry } from './content-registry.ts';
import { MockPlatformGateway, mockMode } from './platform-gateway.ts';
import { CommonGameProtocolAdapter, type GameProtocolConnection } from './protocol-adapter.ts';
import { InMemoryResumeTokenRegistry } from './resume-token-registry.ts';
import { GameSessionHost } from './session-host.ts';

class FakeConnection implements GameProtocolConnection {
  readonly sent: ServerMessage[] = [];
  readonly closes: Array<{ code: number; reason: string }> = [];
  private messageListener: ((data: string | Uint8Array) => void) | null = null;
  private closeListener: (() => void) | null = null;

  constructor(readonly id: string) {}

  onMessage(listener: (data: string | Uint8Array) => void): void {
    this.messageListener = listener;
  }

  onClose(listener: () => void): void {
    this.closeListener = listener;
  }

  send(data: string | Uint8Array): void {
    const text = typeof data === 'string' ? data : new TextDecoder().decode(data);
    this.sent.push(serverMessageSchema.parse(JSON.parse(text) as unknown));
  }

  close(code: number, reason: string): void {
    this.closes.push({ code, reason });
  }

  receive(message: unknown): void {
    this.messageListener?.(JSON.stringify(message));
  }

  disconnect(): void {
    this.closeListener?.();
  }
}

function setup() {
  const resumeTokens = new InMemoryResumeTokenRegistry();
  const platform = new MockPlatformGateway({
    attemptId: 'attempt-1',
    gameLevelId: 'vsm-baseline-01',
    mode: mockMode('live'),
  });
  const host = new GameSessionHost({
    platformGateway: platform,
    contentRegistry: new BaselineContentRegistry(),
    resumeTokens,
    disconnectDebounceMs: 1_000,
    reconnectGraceMs: 30_000,
  });
  return { host, adapter: new CommonGameProtocolAdapter({ host }) };
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe('CommonGameProtocolAdapter', () => {
  it('authenticates with a platform session key and sends a public snapshot', async () => {
    const { adapter } = setup();
    const connection = new FakeConnection('socket-1');
    adapter.open(connection);

    connection.receive({
      protocolVersion: GAME_PROTOCOL_VERSION,
      type: 'hello',
      requestId: 'hello-1',
      sessionKey: 'platform-key',
    });
    await flush();

    expect(connection.closes).toEqual([]);
    expect(connection.sent).toHaveLength(1);
    expect(connection.sent[0]).toMatchObject({ type: 'session-ready', attemptId: 'attempt-1' });
    expect(JSON.stringify(connection.sent[0])).not.toContain('traits');
    expect(JSON.stringify(connection.sent[0])).not.toContain('rootSeed');
  });

  it('routes movement through the authoritative projection and emits result plus delta', async () => {
    const { adapter } = setup();
    const connection = new FakeConnection('socket-1');
    adapter.open(connection);
    connection.receive({
      protocolVersion: GAME_PROTOCOL_VERSION,
      type: 'hello',
      requestId: 'hello-1',
      sessionKey: 'platform-key',
    });
    await flush();
    const ready = connection.sent[0];
    if (ready?.type !== 'session-ready') throw new Error('Expected session-ready');

    connection.receive({
      protocolVersion: GAME_PROTOCOL_VERSION,
      type: 'move-to',
      requestId: 'move-1',
      knownRevision: ready.snapshot.state.revision,
      targetCellId: 'platform-origin.door',
    });

    expect(connection.sent.slice(1).map((message) => message.type)).toEqual([
      'command-result',
      'delta',
    ]);
    expect(connection.sent[1]).toMatchObject({
      type: 'command-result',
      status: 'accepted',
      revision: 1,
    });
    expect(connection.sent[2]).toMatchObject({ type: 'delta', baseRevision: 0, revision: 1 });
  });

  it('resumes by game-server token without asking the client for an attempt id', async () => {
    const { adapter } = setup();
    const first = new FakeConnection('socket-1');
    adapter.open(first);
    first.receive({
      protocolVersion: GAME_PROTOCOL_VERSION,
      type: 'hello',
      requestId: 'hello-1',
      sessionKey: 'platform-key',
    });
    await flush();
    const ready = first.sent[0];
    if (ready?.type !== 'session-ready' || ready.resumeToken === undefined) {
      throw new Error('Expected session-ready with resume token');
    }
    first.disconnect();

    const resumed = new FakeConnection('socket-2');
    adapter.open(resumed);
    resumed.receive({
      protocolVersion: GAME_PROTOCOL_VERSION,
      type: 'hello',
      requestId: 'hello-2',
      resumeToken: ready.resumeToken,
    });
    await flush();

    expect(resumed.sent[0]).toMatchObject({ type: 'session-ready', attemptId: 'attempt-1' });
    expect(resumed.closes).toEqual([]);
  });

  it('rejects commands before hello', () => {
    const { adapter } = setup();
    const connection = new FakeConnection('socket-1');
    adapter.open(connection);
    connection.receive({
      protocolVersion: GAME_PROTOCOL_VERSION,
      type: 'resync',
      requestId: 'too-early',
    });

    expect(connection.closes).toEqual([
      { code: 1008, reason: 'hello must be the first game protocol message' },
    ]);
  });
});
