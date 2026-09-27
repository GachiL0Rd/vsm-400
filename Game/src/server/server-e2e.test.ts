import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import {
  GAME_PROTOCOL_VERSION,
  type ServerMessage,
  serverMessageSchema,
} from '../common/game-wire.ts';
import { parseServerConfig } from './config.ts';
import { BaselineContentRegistry } from './content-registry.ts';
import { createGameHttpServer } from './http-server.ts';
import { MockPlatformGateway, mockMode } from './platform-gateway.ts';
import { CommonGameProtocolAdapter } from './protocol-adapter.ts';
import { InMemoryResumeTokenRegistry } from './resume-token-registry.ts';
import { GameSessionHost } from './session-host.ts';

function nextMessages(socket: WebSocket, count: number): Promise<ServerMessage[]> {
  return new Promise((resolve, reject) => {
    const messages: ServerMessage[] = [];
    const onError = (error: Error) => {
      socket.off('message', onMessage);
      reject(error);
    };
    const onMessage = (data: WebSocket.RawData) => {
      try {
        messages.push(serverMessageSchema.parse(JSON.parse(data.toString()) as unknown));
        if (messages.length === count) {
          socket.off('error', onError);
          socket.off('message', onMessage);
          resolve(messages);
        }
      } catch (error) {
        socket.off('error', onError);
        socket.off('message', onMessage);
        reject(error);
      }
    };
    socket.on('error', onError);
    socket.on('message', onMessage);
  });
}

function nextMessage(socket: WebSocket): Promise<ServerMessage> {
  return nextMessages(socket, 1).then((messages) => {
    const message = messages[0];
    if (message === undefined) throw new Error('Expected WebSocket message');
    return message;
  });
}

function expectType<T extends ServerMessage['type']>(
  message: ServerMessage | undefined,
  type: T,
): Extract<ServerMessage, { type: T }> {
  if (message?.type !== type) throw new Error(`Expected ${type}`);
  return message as Extract<ServerMessage, { type: T }>;
}

async function authenticate(
  socket: WebSocket,
  requestId: string,
): Promise<Extract<ServerMessage, { type: 'session-ready' }>> {
  const readyPromise = nextMessage(socket);
  socket.send(
    JSON.stringify({
      protocolVersion: GAME_PROTOCOL_VERSION,
      type: 'hello',
      requestId,
      sessionKey: 'platform-key',
    }),
  );
  return expectType(await readyPromise, 'session-ready');
}

async function moveAndComplete(
  socket: WebSocket,
  worker: NonNullable<ReturnType<GameSessionHost['worker']>>,
  revision: number,
  targetCellId: string,
  index: number,
): Promise<number> {
  const movementPromise = nextMessages(socket, 2);
  socket.send(
    JSON.stringify({
      protocolVersion: GAME_PROTOCOL_VERSION,
      type: 'move-to',
      requestId: `move-${index}`,
      knownRevision: revision,
      targetCellId,
    }),
  );
  const [rawResult, rawDelta] = await movementPromise;
  const result = expectType(rawResult, 'command-result');
  const delta = expectType(rawDelta, 'delta');
  expect(result.status).toBe('accepted');
  const movingPlayer = delta.changes.entities?.upsert.find(
    (entity) => entity.kind === 'player' && entity.position.kind === 'moving',
  );
  if (movingPlayer?.position.kind !== 'moving') throw new Error('Expected moving player');

  worker.projection.advanceTo(movingPlayer.position.arrivesAt, worker.publicClock());
  const resyncPromise = nextMessage(socket);
  socket.send(
    JSON.stringify({
      protocolVersion: GAME_PROTOCOL_VERSION,
      type: 'resync',
      requestId: `resync-${index}`,
      knownRevision: delta.revision,
    }),
  );
  return expectType(await resyncPromise, 'snapshot').state.revision;
}

function open(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
}

describe('game server protocol integration', () => {
  it('round-trips hello and an authoritative movement through a real WebSocket', async () => {
    const host = new GameSessionHost({
      platformGateway: new MockPlatformGateway({
        attemptId: 'attempt-e2e',
        gameLevelId: 'vsm-baseline-01',
        mode: mockMode('live'),
      }),
      contentRegistry: new BaselineContentRegistry(),
      resumeTokens: new InMemoryResumeTokenRegistry(),
      disconnectDebounceMs: 1_000,
      reconnectGraceMs: 30_000,
    });
    const app = createGameHttpServer(
      parseServerConfig({ GAME_SERVER_PORT: '4174' }),
      new CommonGameProtocolAdapter({ host }),
    );
    await app.listen(0);
    const address = app.server.address() as AddressInfo;
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/game-ws`);

    try {
      await open(socket);
      const readyPromise = nextMessage(socket);
      socket.send(
        JSON.stringify({
          protocolVersion: GAME_PROTOCOL_VERSION,
          type: 'hello',
          requestId: 'hello-e2e',
          sessionKey: 'platform-key',
        }),
      );
      const ready = await readyPromise;
      if (ready.type !== 'session-ready') throw new Error('Expected session-ready');
      expect(ready.attemptId).toBe('attempt-e2e');

      const updatePromise = nextMessages(socket, 2);
      socket.send(
        JSON.stringify({
          protocolVersion: GAME_PROTOCOL_VERSION,
          type: 'move-to',
          requestId: 'move-e2e',
          knownRevision: ready.snapshot.state.revision,
          targetCellId: 'platform-origin.door',
        }),
      );
      const [result, delta] = await updatePromise;
      if (result === undefined || delta === undefined) throw new Error('Expected result and delta');
      expect(result).toMatchObject({
        type: 'command-result',
        status: 'accepted',
        revision: 1,
      });
      expect(delta).toMatchObject({ type: 'delta', baseRevision: 0, revision: 1 });
    } finally {
      socket.close();
      await app.close();
    }
  });

  it('covers hello, movement, resync, action query and invocation through the real socket', async () => {
    const host = new GameSessionHost({
      platformGateway: new MockPlatformGateway({
        attemptId: 'attempt-contract',
        gameLevelId: 'vsm-baseline-01',
        mode: mockMode('live'),
      }),
      contentRegistry: new BaselineContentRegistry(),
      resumeTokens: new InMemoryResumeTokenRegistry(),
      disconnectDebounceMs: 1_000,
      reconnectGraceMs: 30_000,
    });
    const app = createGameHttpServer(
      parseServerConfig({ GAME_SERVER_PORT: '4174' }),
      new CommonGameProtocolAdapter({ host }),
    );
    await app.listen(0);
    const address = app.server.address() as AddressInfo;
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/game-ws`);

    try {
      await open(socket);
      const ready = await authenticate(socket, 'hello-contract');
      let revision = ready.snapshot.state.revision;
      const worker = host.worker('attempt-contract');
      if (worker === undefined) throw new Error('Expected worker');

      const path = ['platform-origin.door', 'carriage.entry', 'carriage.cabin', 'carriage.service'];
      for (const [index, targetCellId] of path.entries()) {
        revision = await moveAndComplete(socket, worker, revision, targetCellId, index);
      }

      const offerPromise = nextMessage(socket);
      socket.send(
        JSON.stringify({
          protocolVersion: GAME_PROTOCOL_VERSION,
          type: 'query-actions',
          requestId: 'query-service',
          knownRevision: revision,
          target: { kind: 'object', objectId: 'service-point' },
        }),
      );
      const offer = expectType(await offerPromise, 'action-offer');
      expect(offer.actions.length).toBeGreaterThan(0);
      const handle = offer.actions[0]?.handle;
      if (handle === undefined) throw new Error('Expected action handle');

      const invocationPromise = nextMessages(socket, 2);
      socket.send(
        JSON.stringify({
          protocolVersion: GAME_PROTOCOL_VERSION,
          type: 'invoke-action',
          requestId: 'invoke-service',
          knownRevision: revision,
          actionHandle: handle,
        }),
      );
      const [rawResult, rawDelta] = await invocationPromise;
      expect(expectType(rawResult, 'command-result')).toMatchObject({ status: 'accepted' });
      const delta = expectType(rawDelta, 'delta');
      const player = delta.changes.entities?.upsert.find((entity) => entity.kind === 'player');
      expect(player?.heldItem).toBeDefined();
    } finally {
      socket.close();
      await app.close();
    }
  });
});
