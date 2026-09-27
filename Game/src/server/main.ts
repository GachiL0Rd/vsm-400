import process from 'node:process';
import { parseServerConfig } from './config.ts';
import { BaselineContentRegistry } from './content-registry.ts';
import { createGameHttpServer } from './http-server.ts';
import { HttpPlatformGateway, MockPlatformGateway, mockMode } from './platform-gateway.ts';
import { RejectingProtocolAdapter } from './protocol-adapter.ts';
import { InMemoryResumeTokenRegistry } from './resume-token-registry.ts';
import { GameSessionHost } from './session-host.ts';

const config = parseServerConfig(process.env);
const platformGateway =
  config.platform === null
    ? new MockPlatformGateway({
        attemptId: config.mock.attemptId,
        gameLevelId: config.mock.gameLevelId,
        mode: mockMode(config.mock.mode),
      })
    : new HttpPlatformGateway(config.platform);

// The common-wire implementation will replace RejectingProtocolAdapter and call this host.
new GameSessionHost({
  platformGateway,
  contentRegistry: new BaselineContentRegistry(),
  resumeTokens: new InMemoryResumeTokenRegistry(),
  disconnectDebounceMs: config.disconnectDebounceMs,
  reconnectGraceMs: config.reconnectGraceMs,
});

const application = createGameHttpServer(config, new RejectingProtocolAdapter());
await application.listen();
console.info(`VSM Game Server listening on http://${config.host}:${config.port}`);
