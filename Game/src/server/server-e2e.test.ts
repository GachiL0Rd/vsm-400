import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import {
  GAME_PROTOCOL_VERSION,
  type ServerMessage,
  serverMessageSchema,
} from '../common/game-wire.ts';
import { secondsToSimTimeUs } from '../simulation/sim-time.ts';
import { parseServerConfig } from './config.ts';
import { BaselineContentRegistry } from './content-registry.ts';
import { finishedGameResultSchema } from './finished-game-result.schema.ts';
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

function nextInvokeBurst(socket: WebSocket): Promise<ServerMessage[]> {
  return new Promise((resolve, reject) => {
    const messages: ServerMessage[] = [];
    let quiet: NodeJS.Timeout | undefined;
    const stop = () => {
      if (quiet !== undefined) clearTimeout(quiet);
      socket.off('message', onMessage);
      socket.off('error', onError);
    };
    const onError = (error: Error) => {
      stop();
      reject(error);
    };
    const onMessage = (data: WebSocket.RawData) => {
      try {
        messages.push(serverMessageSchema.parse(JSON.parse(data.toString()) as unknown));
      } catch (error) {
        stop();
        reject(error);
        return;
      }
      if (quiet !== undefined) clearTimeout(quiet);
      quiet = setTimeout(() => {
        const result = messages.find((message) => message.type === 'command-result');
        const delta = messages.find((message) => message.type === 'delta');
        if (result === undefined) return;
        if (result.status === 'rejected' || delta !== undefined) {
          stop();
          resolve(messages);
        }
      }, 40);
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
  if (message?.type !== type) {
    throw new Error(`Expected ${type}, received ${message?.type ?? 'nothing'}`);
  }
  return message as Extract<ServerMessage, { type: T }>;
}

function requireOfferedAction(
  offer: Extract<ServerMessage, { type: 'action-offer' }>,
  predicate: (
    action: Extract<ServerMessage, { type: 'action-offer' }>['actions'][number],
  ) => boolean,
  description: string,
) {
  const action = offer.actions.find(predicate);
  if (action === undefined) throw new Error(`Expected ${description} action`);
  return action;
}

function completeJournalOnlyForSetup(
  worker: NonNullable<ReturnType<GameSessionHost['worker']>>,
): void {
  let offer = worker.projection.queryActions({
    protocolVersion: GAME_PROTOCOL_VERSION,
    type: 'query-actions',
    requestId: 'setup-journal-take',
    knownRevision: worker.projection.revision,
    target: { kind: 'object', objectId: 'acceptance-journal' },
  });
  const takeJournal = requireOfferedAction(
    offer,
    (action) => action.label === 'Взять журнал приёмки',
    'journal take',
  );
  worker.projection.invoke({
    protocolVersion: GAME_PROTOCOL_VERSION,
    type: 'invoke-action',
    requestId: 'setup-journal-take-invoke',
    knownRevision: worker.projection.revision,
    actionHandle: takeJournal.handle,
  });

  offer = worker.projection.queryActions({
    protocolVersion: GAME_PROTOCOL_VERSION,
    type: 'query-actions',
    requestId: 'setup-journal-edit',
    knownRevision: worker.projection.revision,
    target: { kind: 'entity', entityId: 'player' },
  });
  const editJournal = requireOfferedAction(
    offer,
    (action) => action.form?.kind === 'acceptance-journal',
    'journal form',
  );
  worker.projection.invoke({
    protocolVersion: GAME_PROTOCOL_VERSION,
    type: 'invoke-action',
    requestId: 'setup-journal-edit-invoke',
    knownRevision: worker.projection.revision,
    actionHandle: editJournal.handle,
    input: {
      communication: 'ok',
      extinguisher: 'ok',
      climate: 'ok',
      emergencyBrake: 'ok',
      sanitation: 'clean',
      note: '',
      accepted: true,
    },
  });

  offer = worker.projection.queryActions({
    protocolVersion: GAME_PROTOCOL_VERSION,
    type: 'query-actions',
    requestId: 'setup-journal-return',
    knownRevision: worker.projection.revision,
    target: { kind: 'entity', entityId: 'player' },
  });
  const returnJournal = requireOfferedAction(
    offer,
    (action) => action.label === 'Сдать журнал приёмки',
    'journal return',
  );
  worker.projection.invoke({
    protocolVersion: GAME_PROTOCOL_VERSION,
    type: 'invoke-action',
    requestId: 'setup-journal-return-invoke',
    knownRevision: worker.projection.revision,
    actionHandle: returnJournal.handle,
  });
  worker.projection.advanceTo(secondsToSimTimeUs(5 * 60), worker.publicClock());
}

function completeJournalForIncidentSetup(
  worker: NonNullable<ReturnType<GameSessionHost['worker']>>,
): void {
  completeJournalOnlyForSetup(worker);
  worker.projection.attempt.decidePassengerBoarding('passenger-1', 'admit');
  worker.projection.attempt.decidePassengerBoarding('passenger-2', 'admit');
  worker.projection.attempt.decidePassengerBoarding('passenger-3', 'reject');
  worker.projection.refresh(worker.publicClock());
  // Boarding lines were applied outside the socket. Capture them into the
  // tracker and drop the buffer so a later tick does not publish them before resync.
  worker.projection.advanceTo(worker.projection.attempt.time, worker.publicClock());
  worker.projection.takePresentationEvents();
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

  it('round-trips the acceptance journal form through the real socket', async () => {
    const host = new GameSessionHost({
      platformGateway: new MockPlatformGateway({
        attemptId: 'attempt-journal',
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
      const ready = await authenticate(socket, 'hello-journal');
      let revision = ready.snapshot.state.revision;

      const takeOfferPromise = nextMessage(socket);
      socket.send(
        JSON.stringify({
          protocolVersion: GAME_PROTOCOL_VERSION,
          type: 'query-actions',
          requestId: 'query-journal',
          knownRevision: revision,
          target: { kind: 'object', objectId: 'acceptance-journal' },
        }),
      );
      const takeOffer = expectType(await takeOfferPromise, 'action-offer');
      const takeHandle = takeOffer.actions[0]?.handle;
      if (takeHandle === undefined) throw new Error('Expected take journal action');

      const takeResultPromise = nextMessages(socket, 2);
      socket.send(
        JSON.stringify({
          protocolVersion: GAME_PROTOCOL_VERSION,
          type: 'invoke-action',
          requestId: 'take-journal',
          knownRevision: revision,
          actionHandle: takeHandle,
        }),
      );
      const [, takeDeltaRaw] = await takeResultPromise;
      revision = expectType(takeDeltaRaw, 'delta').revision;

      const formOfferPromise = nextMessage(socket);
      socket.send(
        JSON.stringify({
          protocolVersion: GAME_PROTOCOL_VERSION,
          type: 'query-actions',
          requestId: 'query-player',
          knownRevision: revision,
          target: { kind: 'entity', entityId: 'player' },
        }),
      );
      const formOffer = expectType(await formOfferPromise, 'action-offer');
      const formAction = formOffer.actions.find(
        (action) => action.form?.kind === 'acceptance-journal',
      );
      if (formAction === undefined) throw new Error('Expected journal form action');
      expect(formAction.form?.value).toMatchObject({ communication: 'unset', accepted: false });

      const editResultPromise = nextMessages(socket, 2);
      socket.send(
        JSON.stringify({
          protocolVersion: GAME_PROTOCOL_VERSION,
          type: 'invoke-action',
          requestId: 'edit-journal',
          knownRevision: revision,
          actionHandle: formAction.handle,
          input: {
            communication: 'ok',
            extinguisher: 'ok',
            climate: 'ok',
            emergencyBrake: 'ok',
            sanitation: 'clean',
            note: '',
            accepted: true,
          },
        }),
      );
      const [, editDeltaRaw] = await editResultPromise;
      revision = expectType(editDeltaRaw, 'delta').revision;

      const returnOfferPromise = nextMessage(socket);
      socket.send(
        JSON.stringify({
          protocolVersion: GAME_PROTOCOL_VERSION,
          type: 'query-actions',
          requestId: 'query-return',
          knownRevision: revision,
          target: { kind: 'entity', entityId: 'player' },
        }),
      );
      const returnOffer = expectType(await returnOfferPromise, 'action-offer');
      const returnAction = returnOffer.actions.find(
        (action) => action.label === 'Сдать журнал приёмки',
      );
      expect(returnAction).toBeDefined();
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

  it('round-trips passenger document inspection and boarding decisions through the real socket', async () => {
    const host = new GameSessionHost({
      platformGateway: new MockPlatformGateway({
        attemptId: 'attempt-boarding',
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
      const ready = await authenticate(socket, 'hello-boarding');
      const worker = host.worker(ready.attemptId);
      if (worker === undefined) throw new Error('Expected boarding worker');
      completeJournalOnlyForSetup(worker);

      const setupPromise = nextMessage(socket);
      socket.send(
        JSON.stringify({
          protocolVersion: GAME_PROTOCOL_VERSION,
          type: 'resync',
          requestId: 'resync-boarding',
          knownRevision: ready.snapshot.state.revision,
        }),
      );
      let snapshot = expectType(await setupPromise, 'snapshot');
      let revision = snapshot.state.revision;
      expect(snapshot.state.phase).toEqual({ kind: 'origin-stop' });
      expect(
        snapshot.state.entities.find((entity) => entity.id === 'passenger-1')?.position,
      ).toEqual({
        kind: 'cell',
        cellId: 'platform-origin.door',
      });

      for (const [passengerId, decision] of [
        ['passenger-1', 'admit'],
        ['passenger-2', 'admit'],
        ['passenger-3', 'reject'],
      ] as const) {
        const offerPromise = nextMessage(socket);
        socket.send(
          JSON.stringify({
            protocolVersion: GAME_PROTOCOL_VERSION,
            type: 'query-actions',
            requestId: `query-${passengerId}`,
            knownRevision: revision,
            target: { kind: 'entity', entityId: passengerId },
          }),
        );
        const offer = expectType(await offerPromise, 'action-offer');
        const documents = requireOfferedAction(
          offer,
          (action) => action.form?.kind === 'passenger-documents',
          'passenger documents',
        );
        expect(JSON.stringify(documents)).not.toContain('expectedBoardingDecision');
        if (passengerId === 'passenger-3') {
          expect(documents.form).toMatchObject({
            kind: 'passenger-documents',
            value: {
              ticket: { passengerName: 'Алексей Сидоров' },
              identity: { passengerName: 'Андрей Сидоров' },
            },
          });
        }

        const resultPromise = nextInvokeBurst(socket);
        socket.send(
          JSON.stringify({
            protocolVersion: GAME_PROTOCOL_VERSION,
            type: 'invoke-action',
            requestId: `decide-${passengerId}`,
            knownRevision: revision,
            actionHandle: documents.handle,
            input: { decision },
          }),
        );
        const burst = await resultPromise;
        expect(expectType(burst[0], 'command-result')).toMatchObject({ status: 'accepted' });
        revision = expectType(burst[1], 'delta').revision;
        for (const message of burst.slice(2)) {
          expect(message.type).toBe('presentation-event');
        }
      }

      worker.projection.advanceTo(secondsToSimTimeUs(35 * 60), worker.publicClock());
      const finalPromise = nextMessage(socket);
      socket.send(
        JSON.stringify({
          protocolVersion: GAME_PROTOCOL_VERSION,
          type: 'resync',
          requestId: 'resync-after-boarding',
          knownRevision: revision,
        }),
      );
      snapshot = expectType(await finalPromise, 'snapshot');
      expect(snapshot.state.phase).toEqual({ kind: 'travel', nextStopIndex: 0 });
      expect(snapshot.state.entities.some((entity) => entity.id === 'passenger-3')).toBe(false);
      expect(
        snapshot.state.entities.find((entity) => entity.id === 'passenger-1')?.position,
      ).toEqual({
        kind: 'cell',
        cellId: 'carriage.seat-1',
      });
    } finally {
      socket.close();
      await app.close();
    }
  });

  it('round-trips held extinguisher preparation and fire suppression through the real socket', async () => {
    const host = new GameSessionHost({
      platformGateway: new MockPlatformGateway({
        attemptId: 'attempt-fire',
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
      const ready = await authenticate(socket, 'hello-fire');
      const worker = host.worker('attempt-fire');
      if (worker === undefined) throw new Error('Expected worker');

      // The journal has its own real-socket test above. Complete that prerequisite
      // through the projection contract, then resynchronize the real client before
      // exercising the extinguisher/fire path entirely through WebSocket messages.
      completeJournalForIncidentSetup(worker);

      const setupSnapshotPromise = nextMessage(socket);
      socket.send(
        JSON.stringify({
          protocolVersion: GAME_PROTOCOL_VERSION,
          type: 'resync',
          requestId: 'resync-fire-setup',
          knownRevision: ready.snapshot.state.revision,
        }),
      );
      let revision = expectType(await setupSnapshotPromise, 'snapshot').state.revision;

      for (const [index, targetCellId] of [
        'platform-origin.door',
        'carriage.entry',
        'carriage.cabin',
      ].entries()) {
        revision = await moveAndComplete(socket, worker, revision, targetCellId, 100 + index);
      }

      const wallOfferPromise = nextMessage(socket);
      socket.send(
        JSON.stringify({
          protocolVersion: GAME_PROTOCOL_VERSION,
          type: 'query-actions',
          requestId: 'query-extinguisher-wall-e2e',
          knownRevision: revision,
          target: { kind: 'object', objectId: 'extinguisher' },
        }),
      );
      const wallOffer = expectType(await wallOfferPromise, 'action-offer');
      const takeExtinguisher = requireOfferedAction(
        wallOffer,
        (action) => action.label === 'Взять огнетушитель',
        'take extinguisher',
      );

      const takeResultPromise = nextMessages(socket, 2);
      socket.send(
        JSON.stringify({
          protocolVersion: GAME_PROTOCOL_VERSION,
          type: 'invoke-action',
          requestId: 'take-extinguisher-e2e',
          knownRevision: revision,
          actionHandle: takeExtinguisher.handle,
        }),
      );
      const [, takeDeltaRaw] = await takeResultPromise;
      revision = expectType(takeDeltaRaw, 'delta').revision;

      const heldOfferPromise = nextMessage(socket);
      socket.send(
        JSON.stringify({
          protocolVersion: GAME_PROTOCOL_VERSION,
          type: 'query-actions',
          requestId: 'query-held-extinguisher-e2e',
          knownRevision: revision,
          target: { kind: 'entity', entityId: 'player' },
        }),
      );
      const heldOffer = expectType(await heldOfferPromise, 'action-offer');
      const inspectHeld = requireOfferedAction(
        heldOffer,
        (action) => action.form?.kind === 'extinguisher-inspection',
        'held extinguisher form',
      );
      expect(inspectHeld.form).toMatchObject({
        kind: 'extinguisher-inspection',
        value: { pin: 'present', canRemovePin: true },
      });

      const prepareResultPromise = nextMessages(socket, 2);
      socket.send(
        JSON.stringify({
          protocolVersion: GAME_PROTOCOL_VERSION,
          type: 'invoke-action',
          requestId: 'remove-pin-e2e',
          knownRevision: revision,
          actionHandle: inspectHeld.handle,
          input: { removePin: true },
        }),
      );
      const [, prepareDeltaRaw] = await prepareResultPromise;
      revision = expectType(prepareDeltaRaw, 'delta').revision;

      worker.projection.advanceTo(secondsToSimTimeUs(45 * 60), worker.publicClock());
      const fireSnapshotPromise = nextMessage(socket);
      socket.send(
        JSON.stringify({
          protocolVersion: GAME_PROTOCOL_VERSION,
          type: 'resync',
          requestId: 'resync-fire-active',
          knownRevision: revision,
        }),
      );
      const fireSnapshot = expectType(await fireSnapshotPromise, 'snapshot');
      revision = fireSnapshot.state.revision;
      expect(fireSnapshot.state.world.objects).toContainEqual({
        id: 'fire:carriage.cabin',
        kind: 'fire',
        visualId: 'effect.fire',
        cellId: 'carriage.cabin',
      });

      const fireOfferPromise = nextMessage(socket);
      socket.send(
        JSON.stringify({
          protocolVersion: GAME_PROTOCOL_VERSION,
          type: 'query-actions',
          requestId: 'query-fire-e2e',
          knownRevision: revision,
          target: { kind: 'object', objectId: 'fire:carriage.cabin' },
        }),
      );
      const fireOffer = expectType(await fireOfferPromise, 'action-offer');
      const useExtinguisher = requireOfferedAction(
        fireOffer,
        (action) => action.label === 'Применить огнетушитель',
        'extinguisher use',
      );

      const useResultPromise = nextMessages(socket, 2);
      socket.send(
        JSON.stringify({
          protocolVersion: GAME_PROTOCOL_VERSION,
          type: 'invoke-action',
          requestId: 'use-extinguisher-e2e',
          knownRevision: revision,
          actionHandle: useExtinguisher.handle,
        }),
      );
      const [useResultRaw, useDeltaRaw] = await useResultPromise;
      expect(expectType(useResultRaw, 'command-result')).toMatchObject({ status: 'accepted' });
      const useDelta = expectType(useDeltaRaw, 'delta');
      expect(useDelta.changes.world?.objects?.some((object) => object.kind === 'fire')).toBe(false);
    } finally {
      socket.close();
      await app.close();
    }
  });

  it('refreshes climate-control readings through the real socket after a pressure incident starts', async () => {
    const host = new GameSessionHost({
      platformGateway: new MockPlatformGateway({
        attemptId: 'attempt-climate',
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
      const ready = await authenticate(socket, 'hello-climate');
      const worker = host.worker(ready.attemptId);
      if (worker === undefined) throw new Error('Expected climate worker');
      completeJournalForIncidentSetup(worker);

      for (const edgeId of [
        'origin-desk-door:forward',
        'origin-door-entry:forward',
        'entry-cabin:forward',
      ]) {
        const movement = worker.projection.attempt.movePlayer(edgeId);
        worker.projection.attempt.advanceTo(movement.arrivesAt);
      }
      worker.projection.attempt.takeExtinguisher();
      worker.projection.attempt.prepareExtinguisher();
      worker.projection.advanceTo(secondsToSimTimeUs(45 * 60), worker.publicClock());
      worker.projection.attempt.useExtinguisher('fire:carriage.cabin');
      worker.projection.refresh(worker.publicClock());
      worker.projection.advanceTo(secondsToSimTimeUs(70 * 60), worker.publicClock());

      const snapshotPromise = nextMessage(socket);
      socket.send(
        JSON.stringify({
          protocolVersion: GAME_PROTOCOL_VERSION,
          type: 'resync',
          requestId: 'resync-climate',
          knownRevision: ready.snapshot.state.revision,
        }),
      );
      const snapshot = expectType(await snapshotPromise, 'snapshot');
      let revision = snapshot.state.revision;

      const offerPromise = nextMessage(socket);
      socket.send(
        JSON.stringify({
          protocolVersion: GAME_PROTOCOL_VERSION,
          type: 'query-actions',
          requestId: 'query-climate-e2e',
          knownRevision: revision,
          target: { kind: 'object', objectId: 'climate-control' },
        }),
      );
      const offer = expectType(await offerPromise, 'action-offer');
      const climate = requireOfferedAction(
        offer,
        (action) => action.form?.kind === 'climate-control',
        'climate form',
      );
      expect(climate.form).toMatchObject({
        kind: 'climate-control',
        value: { pressureKPa: 101.3, canRefresh: true },
      });

      const refreshPromise = nextMessages(socket, 2);
      socket.send(
        JSON.stringify({
          protocolVersion: GAME_PROTOCOL_VERSION,
          type: 'invoke-action',
          requestId: 'refresh-climate-e2e',
          knownRevision: revision,
          actionHandle: climate.handle,
          input: { refresh: true },
        }),
      );
      const [, deltaRaw] = await refreshPromise;
      revision = expectType(deltaRaw, 'delta').revision;

      const currentPromise = nextMessage(socket);
      socket.send(
        JSON.stringify({
          protocolVersion: GAME_PROTOCOL_VERSION,
          type: 'query-actions',
          requestId: 'query-climate-current-e2e',
          knownRevision: revision,
          target: { kind: 'object', objectId: 'climate-control' },
        }),
      );
      const current = expectType(await currentPromise, 'action-offer');
      const currentClimate = requireOfferedAction(
        current,
        (action) => action.form?.kind === 'climate-control',
        'refreshed climate form',
      );
      if (currentClimate.form?.kind !== 'climate-control') throw new Error('Expected climate form');
      expect(currentClimate.form.value.pressureKPa).toBeLessThan(101.3);
    } finally {
      socket.close();
      await app.close();
    }
  });

  it('sends a schema-valid presentation event when boarding opens', async () => {
    const host = new GameSessionHost({
      platformGateway: new MockPlatformGateway({
        attemptId: 'attempt-presentation',
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
      const ready = await authenticate(socket, 'hello-presentation');
      const worker = host.worker(ready.attemptId);
      if (worker === undefined) throw new Error('Expected presentation worker');
      worker.projection.advanceTo(secondsToSimTimeUs(5 * 60), worker.publicClock());

      let offer = worker.projection.queryActions({
        protocolVersion: GAME_PROTOCOL_VERSION,
        type: 'query-actions',
        requestId: 'presentation-journal-take',
        knownRevision: worker.projection.revision,
        target: { kind: 'object', objectId: 'acceptance-journal' },
      });
      const takeJournal = requireOfferedAction(
        offer,
        (action) => action.label === 'Взять журнал приёмки',
        'journal take',
      );
      worker.projection.invoke({
        protocolVersion: GAME_PROTOCOL_VERSION,
        type: 'invoke-action',
        requestId: 'presentation-journal-take-invoke',
        knownRevision: worker.projection.revision,
        actionHandle: takeJournal.handle,
      });
      offer = worker.projection.queryActions({
        protocolVersion: GAME_PROTOCOL_VERSION,
        type: 'query-actions',
        requestId: 'presentation-journal-edit',
        knownRevision: worker.projection.revision,
        target: { kind: 'entity', entityId: 'player' },
      });
      const editJournal = requireOfferedAction(
        offer,
        (action) => action.form?.kind === 'acceptance-journal',
        'journal form',
      );
      worker.projection.invoke({
        protocolVersion: GAME_PROTOCOL_VERSION,
        type: 'invoke-action',
        requestId: 'presentation-journal-edit-invoke',
        knownRevision: worker.projection.revision,
        actionHandle: editJournal.handle,
        input: {
          communication: 'ok',
          extinguisher: 'ok',
          climate: 'ok',
          emergencyBrake: 'ok',
          sanitation: 'clean',
          note: '',
          accepted: true,
        },
      });

      const resyncPromise = nextMessage(socket);
      socket.send(
        JSON.stringify({
          protocolVersion: GAME_PROTOCOL_VERSION,
          type: 'resync',
          requestId: 'resync-presentation',
          knownRevision: ready.snapshot.state.revision,
        }),
      );
      const snapshot = expectType(await resyncPromise, 'snapshot');
      expect(snapshot.state.phase).toEqual({ kind: 'pre-departure' });

      const offerPromise = nextMessage(socket);
      socket.send(
        JSON.stringify({
          protocolVersion: GAME_PROTOCOL_VERSION,
          type: 'query-actions',
          requestId: 'query-presentation-return',
          knownRevision: snapshot.state.revision,
          target: { kind: 'entity', entityId: 'player' },
        }),
      );
      const returnOffer = expectType(await offerPromise, 'action-offer');
      const returnJournal = requireOfferedAction(
        returnOffer,
        (action) => action.label === 'Сдать журнал приёмки',
        'journal return',
      );

      const publishedPromise = nextMessages(socket, 3);
      socket.send(
        JSON.stringify({
          protocolVersion: GAME_PROTOCOL_VERSION,
          type: 'invoke-action',
          requestId: 'return-presentation',
          knownRevision: snapshot.state.revision,
          actionHandle: returnJournal.handle,
        }),
      );
      const [resultRaw, deltaRaw, eventRaw] = await publishedPromise;
      expect(expectType(resultRaw, 'command-result')).toMatchObject({ status: 'accepted' });
      expect(expectType(deltaRaw, 'delta').changes.phase).toEqual({ kind: 'origin-stop' });
      const event = expectType(eventRaw, 'presentation-event');
      expect(event.event).toEqual({
        kind: 'notification',
        notificationId: 'phase:origin-stop',
        text: 'Посадка пассажиров открыта',
      });
      expect(event.at).toBeGreaterThanOrEqual(secondsToSimTimeUs(5 * 60));
      expect(event.sequence).toBe(0);
      expect(JSON.stringify(event)).not.toContain('request-drink');
      expect(JSON.stringify(event)).not.toContain('annoyed');
    } finally {
      socket.close();
      await app.close();
    }
  });

  it('sends a schema-valid assessment when the mock platform receives the finish body', async () => {
    const gateway = new MockPlatformGateway({
      attemptId: 'attempt-assessment',
      gameLevelId: 'vsm-baseline-01',
      mode: mockMode('live'),
    });
    const host = new GameSessionHost({
      platformGateway: gateway,
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
      const ready = await authenticate(socket, 'hello-assessment');
      const worker = host.worker(ready.attemptId);
      if (worker === undefined) throw new Error('Expected assessment worker');
      const attempt = worker.projection.attempt;
      attempt.takeJournal();
      attempt.editJournal({
        communication: 'ok',
        extinguisher: 'problem',
        climate: 'ok',
        emergencyBrake: 'ok',
        sanitation: 'clean',
        note: 'pressure gauge outside normal range',
        accepted: true,
      });
      attempt.returnJournal();
      expect(attempt.termination).toMatchObject({ outcomeId: 'wagon-unserviceable' });
      await worker.finish();

      expect(gateway.finished).toHaveLength(1);
      const finished = gateway.finished[0];
      expect(finishedGameResultSchema.parse(JSON.parse(JSON.stringify(finished)))).toEqual(
        finished,
      );
      expect(finished?.assessment).toMatchObject({
        setVersion: 'baseline-v2',
        durationUs: 0,
        facts: [
          {
            id: 'journal-submission',
            kind: 'journal-submission',
            at: 0,
            verdict: 'incorrect',
            scoreDelta: { safety: -10, customerSatisfaction: -40 },
          },
        ],
      });
    } finally {
      socket.close();
      await app.close();
    }
  });
});
