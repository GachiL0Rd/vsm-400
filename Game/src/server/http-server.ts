import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { type RawData, type WebSocket, WebSocketServer } from 'ws';
import type { ServerConfig } from './config.ts';
import type { GameProtocolAdapter, GameProtocolConnection } from './protocol-adapter.ts';

export interface GameHttpServer {
  readonly server: Server;
  listen(port?: number, host?: string): Promise<void>;
  close(): Promise<void>;
}

export function createGameHttpServer(
  config: ServerConfig,
  protocol: GameProtocolAdapter,
): GameHttpServer {
  const webSocketServer = new WebSocketServer({ noServer: true });
  const server = createServer((request, response) => {
    void handleHttp(request, response, config.staticClientDirectory).catch(() => {
      response.writeHead(500).end('Internal server error');
    });
  });
  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (pathname !== '/game-ws') {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    webSocketServer.handleUpgrade(request, socket, head, (webSocket) =>
      protocol.open(new WsConnection(webSocket)),
    );
  });
  return {
    server,
    listen: (port = config.port, host = config.host) => listen(server, port, host),
    close: async () => {
      for (const client of webSocketServer.clients) client.terminate();
      await close(server);
      webSocketServer.close();
    },
  };
}

async function handleHttp(
  request: IncomingMessage,
  response: ServerResponse,
  staticDirectory: string | null,
): Promise<void> {
  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
  if (request.method === 'GET' && pathname === '/health') {
    response.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    });
    response.end(JSON.stringify({ status: 'ok' }));
    return;
  }
  if (request.method !== 'GET' || staticDirectory === null) {
    response.writeHead(404).end();
    return;
  }
  const staticRoot = resolve(staticDirectory);
  const requested =
    pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const candidate = resolve(staticRoot, requested);
  const safeCandidate = candidate === staticRoot || candidate.startsWith(`${staticRoot}${sep}`);
  const file = safeCandidate ? await existingFile(candidate) : null;
  if (file !== null) {
    response.writeHead(200, { 'content-type': mimeType(file) });
    response.end(await readFile(file));
    return;
  }
  if (extname(requested) !== '') {
    response.writeHead(404).end();
    return;
  }
  const index = await existingFile(resolve(staticRoot, 'index.html'));
  if (index === null) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(await readFile(index));
}

async function existingFile(path: string): Promise<string | null> {
  try {
    return (await stat(path)).isFile() ? path : null;
  } catch {
    return null;
  }
}

function mimeType(path: string): string {
  switch (extname(path)) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
}

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolvePromise();
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolvePromise, reject) =>
    server.close((error) => (error === undefined ? resolvePromise() : reject(error))),
  );
}

class WsConnection implements GameProtocolConnection {
  readonly id = randomUUID();

  constructor(private readonly socket: WebSocket) {}

  onMessage(listener: (data: string | Uint8Array) => void): void {
    this.socket.on('message', (data, isBinary) =>
      listener(isBinary ? bytesOf(data) : data.toString()),
    );
  }

  onClose(listener: () => void): void {
    this.socket.once('close', listener);
  }

  close(code: number, reason: string): void {
    this.socket.close(code, reason);
  }
}

function bytesOf(data: RawData): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  return new Uint8Array(data);
}
