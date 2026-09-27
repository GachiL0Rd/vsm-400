import { describe, expect, it } from 'vitest';
import {
  GAME_PROTOCOL_VERSION,
  type PublicEntityView,
  type ServerMessage,
  serverMessageSchema,
} from '../common/game-wire.ts';
import { BaselineContentRegistry } from './content-registry.ts';
import type { WorkerClock, WorkerScheduler, WorkerTimer } from './game-session-worker.ts';
import { MockPlatformGateway, mockMode } from './platform-gateway.ts';
import { CommonGameProtocolAdapter, type GameProtocolConnection } from './protocol-adapter.ts';
import { InMemoryResumeTokenRegistry } from './resume-token-registry.ts';
import { GameSessionHost } from './session-host.ts';

class FakeConnection implements GameProtocolConnection {
  readonly sent: ServerMessage[] = [];
  private messageListener: ((data: string | Uint8Array) => void) | null = null;

  constructor(readonly id: string) {}

  onMessage(listener: (data: string | Uint8Array) => void): void {
    this.messageListener = listener;
  }

  onClose(): void {}

  send(data: string | Uint8Array): void {
    const text = typeof data === 'string' ? data : new TextDecoder().decode(data);
    this.sent.push(serverMessageSchema.parse(JSON.parse(text) as unknown));
  }

  close(): void {}

  receive(message: unknown): void {
    this.messageListener?.(JSON.stringify(message));
  }
}

class FakeRuntime implements WorkerScheduler, WorkerClock {
  private now = 0;
  private readonly tasks: Array<{ at: number; active: boolean; callback: () => void }> = [];

  nowMs(): number {
    return this.now;
  }

  after(delayMs: number, callback: () => void): WorkerTimer {
    const task = { at: this.now + delayMs, active: true, callback };
    this.tasks.push(task);
    return {
      cancel: () => {
        task.active = false;
      },
    };
  }

  advanceBy(milliseconds: number): void {
    this.now += milliseconds;
    for (const task of this.tasks.filter(
      (candidate) => candidate.active && candidate.at <= this.now,
    )) {
      task.active = false;
      task.callback();
    }
  }
}

describe('remote move-to', () => {
  it('routes one non-adjacent move-to through the protocol adapter to the final cell', async () => {
    const session = await openBaseline();
    const player = session.ready.snapshot.state.entities.find((entity) => entity.kind === 'player');
    expect(player?.position).toEqual({ kind: 'cell', cellId: 'platform-origin.desk' });

    session.connection.receive({
      protocolVersion: GAME_PROTOCOL_VERSION,
      type: 'move-to',
      requestId: 'move-remote',
      knownRevision: session.ready.snapshot.state.revision,
      targetCellId: 'carriage.service',
    });
    expect(session.connection.sent.filter((message) => message.type === 'command-result')).toEqual([
      expect.objectContaining({
        type: 'command-result',
        status: 'accepted',
        requestId: 'move-remote',
      }),
    ]);

    advance(session.runtime, 100);
    expect(playerRoute(session.connection.sent)).toEqual({
      arrived: true,
      edgeIds: [
        'cabin-service:forward',
        'entry-cabin:forward',
        'origin-desk-door:forward',
        'origin-door-entry:forward',
      ],
    });
    session.adapter.shutdown();
  });
});

async function openBaseline(): Promise<{
  adapter: CommonGameProtocolAdapter;
  connection: FakeConnection;
  runtime: FakeRuntime;
  ready: Extract<ServerMessage, { type: 'session-ready' }>;
}> {
  const runtime = new FakeRuntime();
  const host = new GameSessionHost({
    platformGateway: new MockPlatformGateway({
      attemptId: 'attempt-1',
      gameLevelId: 'vsm-baseline-01',
      mode: mockMode('live'),
    }),
    contentRegistry: new BaselineContentRegistry(),
    resumeTokens: new InMemoryResumeTokenRegistry(),
    disconnectDebounceMs: 1_000,
    reconnectGraceMs: 30_000,
    clock: runtime,
    scheduler: runtime,
  });
  const adapter = new CommonGameProtocolAdapter({ host });
  const connection = new FakeConnection('socket-remote');
  adapter.open(connection);
  connection.receive({
    protocolVersion: GAME_PROTOCOL_VERSION,
    type: 'hello',
    requestId: 'hello-1',
    sessionKey: 'platform-key',
  });
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  const ready = connection.sent[0];
  if (ready?.type !== 'session-ready') throw new Error('Expected session-ready');
  return { adapter, connection, runtime, ready };
}

function advance(runtime: FakeRuntime, steps: number): void {
  for (let step = 0; step < steps; step += 1) runtime.advanceBy(50);
}

function playerRoute(messages: readonly ServerMessage[]): {
  arrived: boolean;
  edgeIds: string[];
} {
  const edgeIds = new Set<string>();
  let arrived = false;
  for (const entity of playerUpserts(messages)) {
    const position = entity.position;
    if (position.kind === 'moving') edgeIds.add(position.edgeId);
    if (position.kind === 'cell' && position.cellId === 'carriage.service') arrived = true;
  }
  return { arrived, edgeIds: [...edgeIds].sort() };
}

function playerUpserts(messages: readonly ServerMessage[]): PublicEntityView[] {
  const players: PublicEntityView[] = [];
  for (const message of messages) {
    if (message.type !== 'delta') continue;
    for (const entity of message.changes.entities?.upsert ?? []) {
      if (entity.kind === 'player') players.push(entity);
    }
  }
  return players;
}
