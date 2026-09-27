import {
  type ClientCommand,
  type CommandResultMessage,
  clientCommandSchema,
  GAME_PROTOCOL_VERSION,
  type ServerMessage,
} from '../common/game-wire.ts';
import type { PublicGameProjection } from '../projection/public-game-session.ts';
import type { GameSessionWorker } from './game-session-worker.ts';
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
}

/** Safe production default until a common-wire adapter is supplied. */
export class RejectingProtocolAdapter implements GameProtocolAdapter {
  open(connection: GameProtocolConnection): void {
    connection.close(1008, 'Game protocol adapter is not configured');
  }
}

export interface CommonGameProtocolAdapterOptions {
  readonly host: GameSessionHost;
}

/**
 * JSON/WebSocket adapter for common protocol v1.
 *
 * Authentication and connection lifetime live here. Simulation state reaches
 * the browser only through PublicGameProjection.
 */
export class CommonGameProtocolAdapter implements GameProtocolAdapter {
  private readonly activeConnections = new Map<string, GameProtocolConnection>();

  constructor(private readonly options: CommonGameProtocolAdapterOptions) {}

  open(connection: GameProtocolConnection): void {
    const state: ConnectionState = { phase: 'awaiting-hello' };
    connection.onMessage((data) => void this.receive(connection, state, data));
    connection.onClose(() => this.closed(connection, state));
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
      send(connection, {
        protocolVersion: GAME_PROTOCOL_VERSION,
        type: 'error',
        code: 'invalid-message',
        message: errorMessage(error),
      });
      connection.close(1007, 'invalid game protocol message');
      return;
    }

    if (state.phase === 'awaiting-hello') {
      if (command.type !== 'hello') {
        connection.close(1008, 'hello must be the first game protocol message');
        return;
      }
      await this.hello(connection, state, command);
      return;
    }

    if (command.type === 'hello') {
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
      connection.close(1008, 'connection is no longer attached to this attempt');
      return;
    }

    this.dispatchAuthenticated(connection, state.worker, command);
  }

  private async hello(
    connection: GameProtocolConnection,
    state: AwaitingHelloState,
    command: Extract<ClientCommand, { type: 'hello' }>,
  ): Promise<void> {
    if ((command.sessionKey === undefined) === (command.resumeToken === undefined)) {
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
      const previous = this.activeConnections.get(attachment.attemptId);
      if (previous !== undefined && previous.id !== connection.id) {
        previous.close(1008, 'session resumed from another connection');
      }
      this.activeConnections.set(attachment.attemptId, connection);
      Object.assign(state, { phase: 'authenticated', attemptId: attachment.attemptId, worker });
      send(connection, {
        protocolVersion: GAME_PROTOCOL_VERSION,
        type: 'session-ready',
        attemptId: attachment.attemptId,
        resumeToken: attachment.resumeToken,
        snapshot: worker.projection.snapshot(worker.publicClock()),
      });
    } catch (error) {
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
    const projection = worker.projection;
    switch (command.type) {
      case 'resync':
        send(connection, projection.snapshot(worker.publicClock()));
        return;
      case 'query-actions':
        if (command.knownRevision !== projection.revision) {
          send(connection, stale(command.requestId, projection.revision));
          return;
        }
        try {
          send(connection, projection.queryActions(command));
        } catch (error) {
          send(connection, rejected(command.requestId, projection.revision, errorMessage(error)));
        }
        return;
      case 'move-to': {
        const result = projection.moveTo(command, worker.publicClock());
        this.sendInvokeResult(connection, worker, result);
        return;
      }
      case 'invoke-action': {
        const result = projection.invoke(command, worker.publicClock());
        this.sendInvokeResult(connection, worker, result);
        return;
      }
      case 'set-time-scale':
        send(connection, {
          protocolVersion: GAME_PROTOCOL_VERSION,
          type: 'command-result',
          requestId: command.requestId,
          status: 'rejected',
          revision: projection.revision,
          code: 'unsupported-command',
          message: 'time scale control is not implemented yet',
        });
        return;
    }
  }

  private sendInvokeResult(
    connection: GameProtocolConnection,
    worker: GameSessionWorker,
    result: ReturnType<PublicGameProjection['invoke']>,
  ): void {
    send(connection, result.result);
    if (result.recordedCommand !== undefined) worker.recordUserInput(result.recordedCommand);
    if (result.delta !== undefined) send(connection, result.delta);
  }

  private closed(connection: GameProtocolConnection, state: ConnectionState): void {
    if (state.phase !== 'authenticated') return;
    if (this.activeConnections.get(state.attemptId)?.id === connection.id) {
      this.activeConnections.delete(state.attemptId);
    }
    this.options.host.detach(state.attemptId, connection.id);
  }
}

type AwaitingHelloState = { phase: 'awaiting-hello' };
type AuthenticatedState = {
  phase: 'authenticated';
  attemptId: string;
  worker: GameSessionWorker;
};
type ConnectionState = AwaitingHelloState | AuthenticatedState;

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
