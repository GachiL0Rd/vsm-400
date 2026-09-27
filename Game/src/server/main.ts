import { existsSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseServerConfig } from './config.ts';
import { FileGameContentRegistry } from './content-registry.ts';
import { createGameHttpServer } from './http-server.ts';
import { createServerLogger } from './logger.ts';
import { HttpPlatformGateway, MockPlatformGateway, mockMode } from './platform-gateway.ts';
import { CommonGameProtocolAdapter } from './protocol-adapter.ts';
import { InMemoryResumeTokenRegistry } from './resume-token-registry.ts';
import { GameSessionHost } from './session-host.ts';

const config = parseServerConfig(runtimeEnvironment(process.env));
const platformGateway =
  config.platform === null
    ? new MockPlatformGateway({
        attemptId: config.mock.attemptId,
        gameLevelId: config.mock.gameLevelId,
        mode: mockMode(config.mock.mode),
      })
    : new HttpPlatformGateway(config.platform);

const host = new GameSessionHost({
  platformGateway,
  contentRegistry: new FileGameContentRegistry(config.contentDirectory),
  resumeTokens: new InMemoryResumeTokenRegistry(),
  disconnectDebounceMs: config.disconnectDebounceMs,
  reconnectGraceMs: config.reconnectGraceMs,
  simulationStepMs: config.simulationStepMs,
  maxCatchUpMs: config.maxCatchUpMs,
});

const protocol = new CommonGameProtocolAdapter({ host });
const application = createGameHttpServer(config, protocol);
const logger = createServerLogger();
await application.listen();
logger.info(
  { event: 'server-listening', host: config.host, port: config.port },
  'Game Server listening',
);

let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ event: 'server-shutdown', signal }, 'Game Server shutting down');
  try {
    await application.close();
    process.exitCode = 0;
  } catch (error) {
    logger.error(
      { err: error, event: 'server-shutdown-failed', signal },
      'Game Server shutdown failed',
    );
    process.exitCode = 1;
  }
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

function runtimeEnvironment(environment: NodeJS.ProcessEnv): Record<string, string | undefined> {
  const resolved = { ...environment };
  if (resolved.GAME_STATIC_DIR === undefined) {
    const bundledClientDirectory = fileURLToPath(new URL('../client/', import.meta.url));
    const bundledIndex = fileURLToPath(new URL('../client/index.html', import.meta.url));
    if (existsSync(bundledIndex)) resolved.GAME_STATIC_DIR = bundledClientDirectory;
  }
  if (resolved.GAME_CONTENT_DIR === undefined) {
    const bundledContent = fileURLToPath(new URL('../content/manifest.json', import.meta.url));
    const sourceContent = fileURLToPath(new URL('../../content/manifest.json', import.meta.url));
    if (existsSync(bundledContent)) {
      resolved.GAME_CONTENT_DIR = fileURLToPath(new URL('../content/', import.meta.url));
    } else if (existsSync(sourceContent)) {
      resolved.GAME_CONTENT_DIR = fileURLToPath(new URL('../../content/', import.meta.url));
    }
  }
  return resolved;
}
