import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { parseServerConfig } from './config.ts';
import { createGameHttpServer } from './http-server.ts';
import {
  type GameProtocolAdapter,
  type GameProtocolConnection,
  RejectingProtocolAdapter,
} from './protocol-adapter.ts';

class HoldingProtocolAdapter implements GameProtocolAdapter {
  connection: GameProtocolConnection | null = null;
  shutdownCalls = 0;

  open(connection: GameProtocolConnection): void {
    this.connection = connection;
  }

  shutdown(): void {
    this.shutdownCalls += 1;
  }
}

describe('Game HTTP server', () => {
  it('serves liveness and readiness separately', async () => {
    const app = createGameHttpServer(
      parseServerConfig({ GAME_SERVER_PORT: '4174' }),
      new RejectingProtocolAdapter(),
    );
    await app.listen(0);
    try {
      const address = app.server.address() as AddressInfo;
      const health = await fetch(`http://127.0.0.1:${address.port}/health`);
      const ready = await fetch(`http://127.0.0.1:${address.port}/ready`);
      await expect(health.json()).resolves.toEqual({ status: 'ok' });
      await expect(ready.json()).resolves.toEqual({ status: 'ready' });
      expect(health.status).toBe(200);
      expect(ready.status).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('fails startup when an explicitly configured static directory is unusable', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'vsm-static-'));
    try {
      const app = createGameHttpServer(
        parseServerConfig({ GAME_STATIC_DIR: directory }),
        new RejectingProtocolAdapter(),
      );
      await expect(app.listen(0)).rejects.toThrow(/index\.html/);
      await app.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('upgrades WebSocket connections and predictably rejects them without a protocol adapter', async () => {
    const app = createGameHttpServer(
      parseServerConfig({ GAME_SERVER_PORT: '4174' }),
      new RejectingProtocolAdapter(),
    );
    await app.listen(0);
    try {
      const address = app.server.address() as AddressInfo;
      const close = await new Promise<{ code: number; reason: string }>(
        (resolvePromise, reject) => {
          const socket = new WebSocket(`ws://127.0.0.1:${address.port}/game-ws`);
          socket.once('error', reject);
          socket.once('close', (code, reason) =>
            resolvePromise({ code, reason: reason.toString() }),
          );
        },
      );
      expect(close).toEqual({ code: 1008, reason: 'Game protocol adapter is not configured' });
    } finally {
      await app.close();
    }
  });

  it('rejects oversized WebSocket frames at the transport boundary', async () => {
    const adapter = new HoldingProtocolAdapter();
    const app = createGameHttpServer(
      parseServerConfig({ GAME_WS_MAX_PAYLOAD_BYTES: '64' }),
      adapter,
    );
    await app.listen(0);
    try {
      const address = app.server.address() as AddressInfo;
      const close = await new Promise<number>((resolvePromise, reject) => {
        const socket = new WebSocket(`ws://127.0.0.1:${address.port}/game-ws`);
        socket.once('error', (error) => {
          if ((error as NodeJS.ErrnoException).code !== 'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH')
            reject(error);
        });
        socket.once('open', () => socket.send('x'.repeat(65)));
        socket.once('close', (code) => resolvePromise(code));
      });
      expect(close).toBe(1009);
    } finally {
      await app.close();
    }
  });

  it('closes a slow client instead of buffering an oversized outbound frame', async () => {
    const adapter = new HoldingProtocolAdapter();
    const app = createGameHttpServer(
      parseServerConfig({ GAME_WS_MAX_BUFFERED_BYTES: '32' }),
      adapter,
    );
    await app.listen(0);
    try {
      const address = app.server.address() as AddressInfo;
      const socket = new WebSocket(`ws://127.0.0.1:${address.port}/game-ws`);
      await new Promise<void>((resolvePromise, reject) => {
        socket.once('open', resolvePromise);
        socket.once('error', reject);
      });
      const closed = new Promise<{ code: number; reason: string }>((resolvePromise) => {
        socket.once('close', (code, reason) => resolvePromise({ code, reason: reason.toString() }));
      });
      adapter.connection?.send('x'.repeat(33));
      await expect(closed).resolves.toEqual({ code: 1013, reason: 'client is too slow' });
    } finally {
      await app.close();
    }
  });

  it('performs a graceful WebSocket shutdown and notifies the protocol adapter', async () => {
    const adapter = new HoldingProtocolAdapter();
    const app = createGameHttpServer(parseServerConfig({ GAME_SHUTDOWN_GRACE_MS: '100' }), adapter);
    await app.listen(0);
    const address = app.server.address() as AddressInfo;
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/game-ws`);
    await new Promise<void>((resolvePromise, reject) => {
      socket.once('open', resolvePromise);
      socket.once('error', reject);
    });
    const closed = new Promise<{ code: number; reason: string }>((resolvePromise) => {
      socket.once('close', (code, reason) => resolvePromise({ code, reason: reason.toString() }));
    });

    await app.close();

    expect(adapter.shutdownCalls).toBe(1);
    await expect(closed).resolves.toEqual({ code: 1001, reason: 'server shutting down' });
  });
});
