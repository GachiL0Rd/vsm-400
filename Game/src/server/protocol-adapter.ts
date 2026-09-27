import {
  type ClientCommand,
  type CommandResultMessage,
  clientCommandSchema,
  GAME_PROTOCOL_VERSION,
  type ServerMessage,
} from '../common/game-wire.ts';
import type {
  PublicGameProjection,
  RecordedGameplayCommand,
} from '../projection/public-game-session.ts';
import type { GameSessionWorker } from './game-session-worker.ts';
import { createSilentServerLogger, type ServerLogger } from './logger.ts';
import type { GameSessionHost } from './session-host.ts';

export interface GameProtocolConnection {
  readonly id: string;
  onMessage(listener: (data: string | Uint8Array) => void): void;
  onClose(listener: () => void): void;
  send(data: string | Uint8Array): void;
  close(code: number, reason: string): void;
}

export interface GameProtocolAdapter {
  open(connection: GameProtocolConnection): void;
  shutdown(): void;
}

/** Safe production default until a common-wire adapter is supplied. */
export class RejectingProtocolAdapter implements GameProtocolAdapter {
  open(connection: GameProtocolConnection): void {
    connection.close(1008, 'Game protocol adapter is not configured');
  }

  shutdown(): void {}
}

export interface CommonGameProtocolAdapterOptions {
  readonly host: GameSessionHost;
  readonly logger?: ServerLogger;
}

/**
 * JSON/WebSocket adapter for common protocol v1.
 *
 * Authentication and connection lifetime live here. Simulation state reaches
 * the browser only through PublicGameProjection.
 */
export class CommonGameProtocolAdapter implements GameProtocolAdapter {
  private readonly activeConnections = new Map<string, GameProtocolConnection>();
  private readonly logger: ServerLogger;

  constructor(private readonly options: CommonGameProtocolAdapterOptions) {
    this.logger = (options.logger ?? createSilentServerLogger()).child({ component: 'protocol' });
  }

  open(connection: GameProtocolConnection): void {
    const state: ConnectionState = { phase: 'awaiting-hello', closed: false };
    this.logger.info(
      { event: 'ws-connection-open', connectionId: connection.id },
      'WebSocket connection opened',
    );
    connection.onMessage((data) => void this.receive(connection, state, data));
    connection.onClose(() => this.closed(connection, state));
  }

  shutdown(): void {
    this.logger.info(
      { event: 'protocol-shutdown', activeConnectionCount: this.activeConnections.size },
      'Shutting down protocol adapter',
    );
    for (const connection of this.activeConnections.values()) {
      connection.close(1001, 'server shutting down');
    }
    this.activeConnections.clear();
    this.options.host.shutdown();
  }

  private async receive(
    connection: GameProtocolConnection,
    state: ConnectionState,
    data: string | Uint8Array,
  ): Promise<void> {
    let command: ClientCommand;
    try {
      command = parseCommand(data);
    } catch (error) {
      this.logger.warn(
        {
          err: error,
          event: 'ws-invalid-message',
          connectionId: connection.id,
          phase: state.phase,
          bytes: typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength,
        },
        'Rejected invalid WebSocket message',
      );
      state.closed = true;
      send(connection, {
        protocolVersion: GAME_PROTOCOL_VERSION,
        type: 'error',
        code: 'invalid-message',
        message: errorMessage(error),
      });
      connection.close(1007, 'invalid game protocol message');
      return;
    }

    this.logger.debug(
      {
        event: 'ws-command-received',
        connectionId: connection.id,
        phase: state.phase,
        command: summarizeClientCommand(command),
      },
      'Received protocol command',
    );

    if (state.phase === 'awaiting-hello') {
      if (command.type !== 'hello') {
        this.logger.warn(
          {
            event: 'ws-protocol-rejected',
            connectionId: connection.id,
            reason: 'hello-required',
            commandType: command.type,
          },
          'Rejected command before hello',
        );
        state.closed = true;
        connection.close(1008, 'hello must be the first game protocol message');
        return;
      }
      Object.assign(state, { phase: 'authenticating' as const });
      await this.hello(connection, state, command);
      return;
    }

    if (state.phase === 'authenticating') {
      this.logger.warn(
        {
          event: 'ws-protocol-rejected',
          connectionId: connection.id,
          reason: 'authentication-in-progress',
          commandType: command.type,
        },
        'Rejected frame while authentication is in progress',
      );
      state.closed = true;
      connection.close(1008, 'hello authentication is already in progress');
      return;
    }

    if (command.type === 'hello') {
      this.logger.warn(
        {
          event: 'ws-protocol-rejected',
          connectionId: connection.id,
          attemptId: state.attemptId,
          reason: 'duplicate-hello',
        },
        'Rejected duplicate hello',
      );
      state.closed = true;
      send(connection, {
        protocolVersion: GAME_PROTOCOL_VERSION,
        type: 'error',
        requestId: command.requestId,
        code: 'already-authenticated',
        message: 'hello is only valid as the first message',
      });
      connection.close(1008, 'hello is only valid as the first message');
      return;
    }

    if (!state.worker.isAttachedConnection(connection.id)) {
      this.logger.warn(
        {
          event: 'ws-protocol-rejected',
          connectionId: connection.id,
          attemptId: state.attemptId,
          reason: 'connection-not-attached',
        },
        'Rejected command from stale connection',
      );
      connection.close(1008, 'connection is no longer attached to this attempt');
      return;
    }

    this.dispatchAuthenticated(connection, state.worker, command);
  }

  private async hello(
    connection: GameProtocolConnection,
    state: { closed: boolean },
    command: Extract<ClientCommand, { type: 'hello' }>,
  ): Promise<void> {
    if ((command.sessionKey === undefined) === (command.resumeToken === undefined)) {
      this.logger.warn(
        {
          event: 'ws-auth-rejected',
          connectionId: connection.id,
          requestId: command.requestId,
          reason: 'invalid-hello-shape',
        },
        'Rejected invalid hello',
      );
      state.closed = true;
      send(connection, {
        protocolVersion: GAME_PROTOCOL_VERSION,
        type: 'error',
        requestId: command.requestId,
        code: 'invalid-hello',
        message: 'hello requires exactly one of sessionKey or resumeToken',
      });
      connection.close(1008, 'invalid hello');
      return;
    }

    try {
      const auth = command.sessionKey !== undefined ? 'session-key' : 'resume-token';
      this.logger.info(
        { event: 'ws-auth-start', connectionId: connection.id, requestId: command.requestId, auth },
        'Authenticating WebSocket connection',
      );
      const attachment =
        command.sessionKey !== undefined
          ? await this.options.host.attachWithSessionKey(command.sessionKey, connection.id)
          : this.options.host.attachWithResumeToken(
              requireValue(command.resumeToken, 'resumeToken'),
              connection.id,
            );
      const worker = requireValue(
        this.options.host.worker(attachment.attemptId),
        `worker ${attachment.attemptId}`,
      );
      if (state.closed) {
        this.logger.info(
          {
            event: 'ws-auth-completed-after-close',
            connectionId: connection.id,
            attemptId: attachment.attemptId,
          },
          'Authentication completed after connection closed; detaching',
        );
        this.options.host.detach(attachment.attemptId, connection.id);
        return;
      }
      const previous = this.activeConnections.get(attachment.attemptId);
      if (previous !== undefined && previous.id !== connection.id) {
        this.logger.info(
          {
            event: 'ws-session-taken-over',
            attemptId: attachment.attemptId,
            previousConnectionId: previous.id,
            connectionId: connection.id,
          },
          'Session resumed from another connection',
        );
        previous.close(1008, 'session resumed from another connection');
      }
      this.activeConnections.set(attachment.attemptId, connection);
      const unsubscribe = worker.subscribePublications((message) => {
        if (worker.isAttachedConnection(connection.id)) send(connection, message);
      });
      Object.assign(state, {
        phase: 'authenticated',
        attemptId: attachment.attemptId,
        worker,
        unsubscribe,
      });
      this.logger.info(
        {
          event: 'ws-auth-succeeded',
          connectionId: connection.id,
          attemptId: attachment.attemptId,
          lifecycle: attachment.lifecycle,
        },
        'WebSocket authentication succeeded',
      );
      send(connection, {
        protocolVersion: GAME_PROTOCOL_VERSION,
        type: 'session-ready',
        attemptId: attachment.attemptId,
        resumeToken: attachment.resumeToken,
        snapshot: worker.projection.snapshot(worker.publicClock()),
      });
    } catch (error) {
      this.logger.warn(
        {
          err: error,
          event: 'ws-auth-failed',
          connectionId: connection.id,
          requestId: command.requestId,
        },
        'WebSocket authentication failed',
      );
      if (state.closed) return;
      state.closed = true;
      send(connection, {
        protocolVersion: GAME_PROTOCOL_VERSION,
        type: 'error',
        requestId: command.requestId,
        code: 'authentication-failed',
        message: errorMessage(error),
      });
      connection.close(1008, 'authentication failed');
    }
  }

  private dispatchAuthenticated(
    connection: GameProtocolConnection,
    worker: GameSessionWorker,
    command: Exclude<ClientCommand, { type: 'hello' }>,
  ): void {
    worker.synchronizeNow();
    const commandLogger = this.logger.child({
      connectionId: connection.id,
      attemptId: worker.attemptId,
      requestId: command.requestId,
      commandType: command.type,
    });
    const projection = worker.projection;
    if (projection.mode.kind === 'replay' && isGameplayCommand(command)) {
      commandLogger.warn(
        {
          event: 'command-rejected',
          reason: 'replay-input-disabled',
          revision: projection.revision,
        },
        'Rejected gameplay command in replay mode',
      );
      send(
        connection,
        unsupported(
          command.requestId,
          projection.revision,
          'Gameplay input is disabled in replay mode',
        ),
      );
      return;
    }
    switch (command.type) {
      case 'resync': {
        const snapshot = projection.snapshot(worker.publicClock());
        commandLogger.info(
          {
            event: 'resync-sent',
            revision: snapshot.state.revision,
            simulationTimeUs: snapshot.state.timeUs,
          },
          'Sent authoritative snapshot',
        );
        send(connection, snapshot);
        return;
      }
      case 'query-actions':
        if (command.knownRevision !== projection.revision) {
          commandLogger.warn(
            {
              event: 'command-rejected',
              reason: 'stale-revision',
              knownRevision: command.knownRevision,
              revision: projection.revision,
            },
            'Rejected stale query-actions',
          );
          send(connection, stale(command.requestId, projection.revision));
          return;
        }
        try {
          const offer = projection.queryActions(command);
          commandLogger.info(
            {
              event: 'action-offer-sent',
              revision: offer.revision,
              target: offer.target,
              actionCount: offer.actions.length,
              actions: offer.actions.map((action) => ({
                handle: action.handle,
                label: action.label,
                uiKind: action.uiKind,
              })),
            },
            'Sent action offer',
          );
          send(connection, offer);
        } catch (error) {
          commandLogger.warn(
            {
              err: error,
              event: 'command-rejected',
              reason: 'query-actions-failed',
              revision: projection.revision,
            },
            'query-actions failed',
          );
          send(connection, rejected(command.requestId, projection.revision, errorMessage(error)));
        }
        return;
      case 'move-to': {
        commandLogger.info(
          {
            event: 'move-request',
            knownRevision: command.knownRevision,
            targetCellId: command.targetCellId,
            revision: projection.revision,
          },
          'Processing movement request',
        );
        const result = projection.moveTo(command, worker.publicClock());
        this.sendInvokeResult(connection, worker, result, commandLogger);
        return;
      }
      case 'invoke-action': {
        commandLogger.info(
          {
            event: 'action-invoke-request',
            knownRevision: command.knownRevision,
            actionHandle: command.actionHandle,
            input: summarizeActionInput(command.input),
            revision: projection.revision,
          },
          'Processing action invocation',
        );
        const result = projection.invoke(command, worker.publicClock());
        this.sendInvokeResult(connection, worker, result, commandLogger);
        return;
      }
      case 'set-time-scale':
        if (command.knownRevision !== projection.revision) {
          commandLogger.warn(
            {
              event: 'command-rejected',
              reason: 'stale-revision',
              knownRevision: command.knownRevision,
              revision: projection.revision,
            },
            'Rejected stale set-time-scale',
          );
          send(connection, stale(command.requestId, projection.revision));
          return;
        }
        try {
          const delta = worker.setTimeScale(command.scale);
          commandLogger.info(
            { event: 'command-accepted', scale: command.scale, revision: delta.revision },
            'Accepted set-time-scale',
          );
          send(connection, {
            protocolVersion: GAME_PROTOCOL_VERSION,
            type: 'command-result',
            requestId: command.requestId,
            status: 'accepted',
            revision: delta.revision,
          });
          worker.publishPublicDelta(delta);
        } catch (error) {
          commandLogger.warn(
            {
              err: error,
              event: 'command-rejected',
              reason: 'set-time-scale-failed',
              revision: projection.revision,
            },
            'set-time-scale failed',
          );
          send(connection, rejected(command.requestId, projection.revision, errorMessage(error)));
        }
        return;
    }
  }

  private sendInvokeResult(
    connection: GameProtocolConnection,
    worker: GameSessionWorker,
    result: ReturnType<PublicGameProjection['invoke']>,
    logger: ServerLogger,
  ): void {
    if (result.result.status === 'accepted') {
      logger.info(
        {
          event: 'command-accepted',
          revision: result.result.revision,
          operation:
            result.recordedCommand === undefined
              ? undefined
              : summarizeRecordedCommand(result.recordedCommand),
          delta: result.delta === undefined ? undefined : summarizeDelta(result.delta),
        },
        'Gameplay command accepted',
      );
    } else {
      logger.warn(
        {
          event: 'command-rejected',
          code: result.result.code,
          message: result.result.message,
          revision: result.result.revision,
        },
        'Gameplay command rejected',
      );
    }
    send(connection, result.result);
    worker.acceptProjectionResult(result);
  }

  private closed(connection: GameProtocolConnection, state: ConnectionState): void {
    state.closed = true;
    this.logger.info(
      {
        event: 'ws-connection-close',
        connectionId: connection.id,
        phase: state.phase,
        ...(state.phase === 'authenticated' ? { attemptId: state.attemptId } : {}),
      },
      'WebSocket connection closed',
    );
    if (state.phase !== 'authenticated') return;
    state.unsubscribe();
    if (this.activeConnections.get(state.attemptId)?.id === connection.id) {
      this.activeConnections.delete(state.attemptId);
    }
    this.options.host.detach(state.attemptId, connection.id);
  }
}

type AwaitingHelloState = { phase: 'awaiting-hello'; closed: boolean };
type AuthenticatingState = { phase: 'authenticating'; closed: boolean };
type AuthenticatedState = {
  phase: 'authenticated';
  closed: boolean;
  attemptId: string;
  worker: GameSessionWorker;
  unsubscribe: () => void;
};
type ConnectionState = AwaitingHelloState | AuthenticatingState | AuthenticatedState;

function summarizeClientCommand(command: ClientCommand): Record<string, unknown> {
  switch (command.type) {
    case 'hello':
      return {
        type: command.type,
        requestId: command.requestId,
        auth:
          command.sessionKey !== undefined
            ? 'session-key'
            : command.resumeToken !== undefined
              ? 'resume-token'
              : 'invalid',
      };
    case 'move-to':
      return {
        type: command.type,
        requestId: command.requestId,
        knownRevision: command.knownRevision,
        targetCellId: command.targetCellId,
      };
    case 'query-actions':
      return {
        type: command.type,
        requestId: command.requestId,
        knownRevision: command.knownRevision,
        target: command.target,
      };
    case 'invoke-action':
      return {
        type: command.type,
        requestId: command.requestId,
        knownRevision: command.knownRevision,
        actionHandle: command.actionHandle,
        input: summarizeActionInput(command.input),
      };
    case 'set-time-scale':
      return {
        type: command.type,
        requestId: command.requestId,
        knownRevision: command.knownRevision,
        scale: command.scale,
      };
    case 'resync':
      return {
        type: command.type,
        requestId: command.requestId,
        knownRevision: command.knownRevision,
      };
  }
}

function summarizeActionInput(input: unknown): unknown {
  if (input === undefined || input === null) return input;
  if (typeof input !== 'object' || Array.isArray(input)) return { type: typeof input };
  const record = input as Record<string, unknown>;
  const safeKeys = ['action', 'decision', 'refresh', 'removePin', 'sanitation', 'communication'];
  return Object.fromEntries(
    safeKeys.filter((key) => key in record).map((key) => [key, record[key]]),
  );
}

function summarizeRecordedCommand(command: RecordedGameplayCommand): Record<string, unknown> {
  switch (command.kind) {
    case 'move':
      return { kind: command.kind, edgeId: command.edgeId };
    case 'move-to':
      return { kind: command.kind, targetCellId: command.targetCellId };
    case 'take-consumable':
      return { kind: command.kind, itemKind: command.itemKind };
    case 'give-held-item':
    case 'use-extinguisher':
      return { kind: command.kind, targetId: command.targetId };
    case 'inspect-extinguisher':
      return { kind: command.kind, removePin: command.value.removePin };
    case 'inspect-climate':
      return { kind: command.kind, refresh: command.value.refresh };
    case 'inspect-emergency-brake':
      return { kind: command.kind, action: command.value.action };
    case 'decide-passenger-boarding':
      return { kind: command.kind, targetId: command.targetId, decision: command.value.decision };
    default:
      return { kind: command.kind };
  }
}

function summarizeDelta(delta: {
  baseRevision: number;
  revision: number;
  changes: Record<string, unknown>;
}): Record<string, unknown> {
  const entities = delta.changes.entities as
    | { upsert?: unknown[]; removeIds?: unknown[] }
    | undefined;
  return {
    baseRevision: delta.baseRevision,
    revision: delta.revision,
    changeKeys: Object.keys(delta.changes),
    entityUpserts: entities?.upsert?.length ?? 0,
    entityRemovals: entities?.removeIds?.length ?? 0,
  };
}

function isGameplayCommand(
  command: Exclude<ClientCommand, { type: 'hello' }>,
): command is Extract<ClientCommand, { type: 'move-to' | 'query-actions' | 'invoke-action' }> {
  return (
    command.type === 'move-to' ||
    command.type === 'query-actions' ||
    command.type === 'invoke-action'
  );
}

function parseCommand(data: string | Uint8Array): ClientCommand {
  if (typeof data !== 'string')
    throw new TypeError('Binary game protocol frames are not supported');
  return clientCommandSchema.parse(JSON.parse(data) as unknown);
}

function send(connection: GameProtocolConnection, message: ServerMessage): void {
  connection.send(JSON.stringify(message));
}

function stale(requestId: string, revision: number): CommandResultMessage {
  return {
    protocolVersion: GAME_PROTOCOL_VERSION,
    type: 'command-result',
    requestId,
    status: 'rejected',
    revision,
    code: 'stale-revision',
    message: 'stale-revision',
  };
}

function unsupported(requestId: string, revision: number, message: string): CommandResultMessage {
  return {
    protocolVersion: GAME_PROTOCOL_VERSION,
    type: 'command-result',
    requestId,
    status: 'rejected',
    revision,
    code: 'unsupported-command',
    message,
  };
}

function rejected(requestId: string, revision: number, message: string): CommandResultMessage {
  return {
    protocolVersion: GAME_PROTOCOL_VERSION,
    type: 'command-result',
    requestId,
    status: 'rejected',
    revision,
    code: 'action-rejected',
    message,
  };
}

function requireValue<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`${label} is required`);
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
