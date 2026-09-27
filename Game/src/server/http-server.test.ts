import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { parseServerConfig } from './config.ts';
import { createGameHttpServer } from './http-server.ts';
import { RejectingProtocolAdapter } from './protocol-adapter.ts';

describe('Game HTTP server', () => {
  it('serves the health endpoint', async () => {
    const app = createGameHttpServer(
      parseServerConfig({ GAME_SERVER_PORT: '4174' }),
      new RejectingProtocolAdapter(),
    );
    await app.listen(0);
    try {
      const address = app.server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${address.port}/health`);
      await expect(response.json()).resolves.toEqual({ status: 'ok' });
      expect(response.status).toBe(200);
    } finally {
      await app.close();
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
});
