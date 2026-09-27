import { spawn } from 'node:child_process';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';

const timeoutMs = 10_000;
const sourceDist = resolve('dist');
const sandbox = await mkdtemp(join(tmpdir(), 'vsm-production-smoke-'));
const isolatedDist = join(sandbox, 'dist');
await cp(sourceDist, isolatedDist, { recursive: true });

const port = await reservePort();
const child = spawn(process.execPath, [join(isolatedDist, 'server', 'main.mjs')], {
  cwd: sandbox,
  env: {
    ...process.env,
    GAME_SERVER_HOST: '127.0.0.1',
    GAME_SERVER_PORT: String(port),
    GAME_STATIC_DIR: undefined,
    PLATFORM_API_URL: undefined,
    PLATFORM_SERVICE_TOKEN: undefined,
    GAME_DISCONNECT_DEBOUNCE_MS: '20',
    GAME_RECONNECT_GRACE_MS: '1000',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stdout = '';
let stderr = '';
child.stdout.setEncoding('utf8');
child.stderr.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  stdout += chunk;
});
child.stderr.on('data', (chunk) => {
  stderr += chunk;
});

try {
  await waitForReady(port);
  await verifyStaticClient(port);
  await verifyWebSocket(port);
  console.log('Production server smoke test passed: static client + WebSocket protocol.');
} catch (error) {
  console.error('Production server stdout:\n', stdout);
  console.error('Production server stderr:\n', stderr);
  throw error;
} finally {
  if (child.exitCode === null) child.kill('SIGTERM');
  await Promise.race([onceExit(child), delay(2_000)]);
  if (child.exitCode === null) child.kill('SIGKILL');
  await rm(sandbox, { recursive: true, force: true });
}

async function reservePort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Failed to reserve port');
  const port = address.port;
  await new Promise((resolvePromise, reject) => server.close((error) => (error ? reject(error) : resolvePromise())));
  return port;
}

async function waitForReady(port) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Production server exited early with ${child.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/ready`);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await delay(50);
  }
  throw new Error('Timed out waiting for production server readiness');
}

async function verifyStaticClient(port) {
  const response = await fetch(`http://127.0.0.1:${port}/`);
  if (!response.ok) throw new Error(`Client root returned ${response.status}`);
  const html = await response.text();
  if (!html.includes('<div id="game">')) throw new Error('Built client index was not served');
  const asset = html.match(/(?:src|href)="(\.\/assets\/[^\"]+)"/)?.[1];
  if (asset === undefined) throw new Error('Built client index does not reference an asset');
  const assetResponse = await fetch(new URL(asset, `http://127.0.0.1:${port}/`));
  if (!assetResponse.ok) throw new Error(`Client asset returned ${assetResponse.status}`);
}

async function verifyWebSocket(port) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/game-ws`);
  await socketOpened(socket);
  try {
    socket.send(
      JSON.stringify({
        protocolVersion: 1,
        type: 'hello',
        requestId: 'production-smoke-hello',
        sessionKey: 'production-smoke-session',
      }),
    );
    const ready = await nextJson(socket);
    if (ready.type !== 'session-ready') throw new Error(`Expected session-ready, got ${String(ready.type)}`);

    const state = ready.snapshot?.state;
    const player = state?.entities?.find((entity) => entity.kind === 'player');
    if (player?.position?.kind !== 'cell') throw new Error('Expected player in a cell');
    const edge = state.world?.edges?.find((candidate) => candidate.fromCellId === player.position.cellId);
    if (edge === undefined) throw new Error('Expected a reachable cell for movement smoke test');

    socket.send(
      JSON.stringify({
        protocolVersion: 1,
        type: 'move-to',
        requestId: 'production-smoke-move',
        knownRevision: state.revision,
        targetCellId: edge.toCellId,
      }),
    );
    const messages = await nextJsonMessages(socket, 2);
    const result = messages.find((message) => message.type === 'command-result');
    const delta = messages.find((message) => message.type === 'delta');
    if (result?.status !== 'accepted') throw new Error('Production server rejected movement smoke command');
    if (delta === undefined) throw new Error('Production server did not publish a movement delta');
  } finally {
    socket.close();
  }
}

function socketOpened(socket) {
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out opening WebSocket')), timeoutMs);
    socket.addEventListener('open', () => {
      clearTimeout(timer);
      resolvePromise();
    }, { once: true });
    socket.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('Failed to open WebSocket'));
    }, { once: true });
  });
}

function nextJson(socket) {
  return nextJsonMessages(socket, 1).then((messages) => messages[0]);
}

function nextJsonMessages(socket, count) {
  return new Promise((resolvePromise, reject) => {
    const messages = [];
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${count} WebSocket message(s)`));
    }, timeoutMs);
    const onMessage = (event) => {
      try {
        messages.push(JSON.parse(typeof event.data === 'string' ? event.data : Buffer.from(event.data).toString('utf8')));
        if (messages.length === count) {
          cleanup();
          resolvePromise(messages);
        }
      } catch (error) {
        cleanup();
        reject(error);
      }
    };
    const onClose = (event) => {
      cleanup();
      reject(new Error(`WebSocket closed early: ${event.code} ${event.reason}`));
    };
    const cleanup = () => {
      clearTimeout(timer);
      socket.removeEventListener('message', onMessage);
      socket.removeEventListener('close', onClose);
    };
    socket.addEventListener('message', onMessage);
    socket.addEventListener('close', onClose);
  });
}

function onceExit(processHandle) {
  if (processHandle.exitCode !== null) return Promise.resolve();
  return new Promise((resolvePromise) => processHandle.once('exit', resolvePromise));
}

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}
