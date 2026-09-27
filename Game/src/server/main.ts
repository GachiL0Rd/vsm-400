import { existsSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseServerConfig } from './config.ts';
import { BaselineContentRegistry } from './content-registry.ts';
import { createGameHttpServer } from './http-server.ts';
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
  contentRegistry: new BaselineContentRegistry(),
  resumeTokens: new InMemoryResumeTokenRegistry(),
  disconnectDebounceMs: config.disconnectDebounceMs,
  reconnectGraceMs: config.reconnectGraceMs,
  simulationStepMs: config.simulationStepMs,
  maxCatchUpMs: config.maxCatchUpMs,
});

const protocol = new CommonGameProtocolAdapter({ host });
const application = createGameHttpServer(config, protocol);
await application.listen();
console.info(`VSM Game Server listening on http://${config.host}:${config.port}`);

let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(`VSM Game Server received ${signal}; shutting down`);
  try {
    await application.close();
    process.exitCode = 0;
  } catch (error) {
    console.error('VSM Game Server shutdown failed', error);
    process.exitCode = 1;
  }
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

function runtimeEnvironment(environment: NodeJS.ProcessEnv): Record<string, string | undefined> {
  if (environment.GAME_STATIC_DIR !== undefined) return environment;
  const bundledClientDirectory = fileURLToPath(new URL('../client/', import.meta.url));
  const bundledIndex = fileURLToPath(new URL('../client/index.html', import.meta.url));
  if (!existsSync(bundledIndex)) return environment;
  return { ...environment, GAME_STATIC_DIR: bundledClientDirectory };
}
