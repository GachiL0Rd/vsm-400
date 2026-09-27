import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { type RawData, WebSocket, WebSocketServer } from 'ws';
import { GAME_WEBSOCKET_PATH } from '../common/game-wire.ts';
import type { ServerConfig } from './config.ts';
import { createSilentServerLogger, type ServerLogger } from './logger.ts';
import type { GameProtocolAdapter, GameProtocolConnection } from './protocol-adapter.ts';

export interface GameHttpServer {
  readonly server: Server;
  listen(port?: number, host?: string): Promise<void>;
  close(): Promise<void>;
}

export function createGameHttpServer(
  config: ServerConfig,
  protocol: GameProtocolAdapter,
  logger: ServerLogger = createSilentServerLogger(),
): GameHttpServer {
  const transportLogger = logger.child({ component: 'http-server' });
  let accepting = false;
  const webSocketServer = new WebSocketServer({
    noServer: true,
    maxPayload: config.webSocketMaxPayloadBytes,
  });
  const server = createServer((request, response) => {
    const startedAt = performance.now();
    response.once('finish', () => {
      transportLogger.debug(
        {
          event: 'http-request',
          method: request.method,
          pathname: safePathname(request.url),
          status: response.statusCode,
          durationMs: elapsedMs(startedAt),
        },
        'HTTP request completed',
      );
    });
    void handleHttp(request, response, config.staticClientDirectory, () => accepting).catch(
      (error) => {
        transportLogger.error(
          {
            err: error,
            event: 'http-request-failed',
            method: request.method,
            pathname: safePathname(request.url),
          },
          'HTTP request failed',
        );
        response.writeHead(500).end('Internal server error');
      },
    );
  });
  server.on('upgrade', (request, socket, head) => {
    if (!accepting) {
      transportLogger.warn(
        {
          event: 'ws-upgrade-rejected',
          reason: 'server-not-ready',
          pathname: safePathname(request.url),
        },
        'Rejected WebSocket upgrade',
      );
      socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (pathname !== GAME_WEBSOCKET_PATH) {
      transportLogger.warn(
        { event: 'ws-upgrade-rejected', reason: 'wrong-path', pathname },
        'Rejected WebSocket upgrade',
      );
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    transportLogger.info({ event: 'ws-upgrade-accepted', pathname }, 'Accepted WebSocket upgrade');
    webSocketServer.handleUpgrade(request, socket, head, (webSocket) =>
      protocol.open(new WsConnection(webSocket, config.webSocketMaxBufferedBytes, transportLogger)),
    );
  });

  return {
    server,
    listen: async (port = config.port, host = config.host) => {
      await validateStaticDirectory(config.staticClientDirectory);
      await listen(server, port, host);
      accepting = true;
      transportLogger.info(
        {
          event: 'http-listening',
          host,
          port,
          staticClient: config.staticClientDirectory !== null,
        },
        'HTTP server is accepting requests',
      );
    },
    close: async () => {
      if (!accepting && !server.listening) return;
      accepting = false;
      transportLogger.info(
        { event: 'http-draining', clientCount: webSocketServer.clients.size },
        'HTTP server is draining',
      );
      protocol.shutdown();
      for (const client of webSocketServer.clients) client.close(1001, 'server shutting down');
      const forceClose = setTimeout(() => {
        transportLogger.warn(
          { event: 'shutdown-force-close', clientCount: webSocketServer.clients.size },
          'Shutdown grace expired; forcing connections closed',
        );
        for (const client of webSocketServer.clients) client.terminate();
        server.closeAllConnections();
      }, config.shutdownGraceMs);
      forceClose.unref();
      try {
        await Promise.all([closeHttpServer(server), closeWebSocketServer(webSocketServer)]);
      } finally {
        clearTimeout(forceClose);
        transportLogger.info({ event: 'http-closed' }, 'HTTP server closed');
      }
    },
  };
}

async function handleHttp(
  request: IncomingMessage,
  response: ServerResponse,
  staticDirectory: string | null,
  ready: () => boolean,
): Promise<void> {
  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
  if (handleStatusEndpoint(request, response, pathname, ready)) return;
  if (request.method !== 'GET' || staticDirectory === null) {
    response.writeHead(404).end();
    return;
  }
  await serveStatic(response, staticDirectory, pathname);
}

function handleStatusEndpoint(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  ready: () => boolean,
): boolean {
  if (request.method !== 'GET') return false;
  if (pathname === '/health') {
    json(response, 200, { status: 'ok' });
    return true;
  }
  if (pathname !== '/ready') return false;
  const isReady = ready();
  json(response, isReady ? 200 : 503, { status: isReady ? 'ready' : 'draining' });
  return true;
}

async function serveStatic(
  response: ServerResponse,
  staticDirectory: string,
  pathname: string,
): Promise<void> {
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

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(body));
}

async function validateStaticDirectory(staticDirectory: string | null): Promise<void> {
  if (staticDirectory === null) return;
  const root = resolve(staticDirectory);
  const directory = await stat(root).catch(() => null);
  if (directory === null) {
    throw new Error(`Configured static client directory does not exist: ${root}`);
  }
  if (!directory.isDirectory()) {
    throw new Error(`Configured static client path is not a directory: ${root}`);
  }
  if ((await existingFile(resolve(root, 'index.html'))) === null) {
    throw new Error(`Configured static client directory has no index.html: ${root}`);
  }
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
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
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

function closeHttpServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolvePromise, reject) =>
    server.close((error) => (error === undefined ? resolvePromise() : reject(error))),
  );
}

function closeWebSocketServer(server: WebSocketServer): Promise<void> {
  return new Promise((resolvePromise) => server.close(() => resolvePromise()));
}

class WsConnection implements GameProtocolConnection {
  readonly id = randomUUID();

  constructor(
    private readonly socket: WebSocket,
    private readonly maxBufferedBytes: number,
    private readonly logger: ServerLogger,
  ) {
    // ws reports protocol/size failures through the socket error event before close.
    // The close code remains the protocol-visible outcome; do not let transport errors
    // escape as uncaught process exceptions.
    this.socket.on('error', (error) => {
      this.logger.warn(
        { err: error, event: 'ws-transport-error', connectionId: this.id },
        'WebSocket transport error',
      );
    });
  }

  onMessage(listener: (data: string | Uint8Array) => void): void {
    this.socket.on('message', (data, isBinary) =>
      listener(isBinary ? bytesOf(data) : data.toString()),
    );
  }

  onClose(listener: () => void): void {
    this.socket.once('close', listener);
  }

  send(data: string | Uint8Array): void {
    if (this.socket.readyState !== WebSocket.OPEN) return;
    const bytes = typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength;
    if (this.socket.bufferedAmount + bytes > this.maxBufferedBytes) {
      this.logger.warn(
        {
          event: 'ws-backpressure-close',
          connectionId: this.id,
          bufferedBytes: this.socket.bufferedAmount,
          outgoingBytes: bytes,
          maxBufferedBytes: this.maxBufferedBytes,
        },
        'Closing slow WebSocket client',
      );
      this.socket.close(1013, 'client is too slow');
      return;
    }
    this.socket.send(data);
  }

  close(code: number, reason: string): void {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    this.socket.close(code, reason);
  }
}

function safePathname(url: string | undefined): string {
  try {
    return new URL(url ?? '/', 'http://localhost').pathname;
  } catch {
    return '<invalid-url>';
  }
}

function elapsedMs(startedAt: number): number {
  return Math.round((performance.now() - startedAt) * 100) / 100;
}

function bytesOf(data: RawData): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  return new Uint8Array(data);
}
