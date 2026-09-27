# Game Server configuration and startup

**Status:** implementation contract for the current server
**Date:** 2026-09-27

This document describes the configuration currently consumed by `src/server/config.ts` and the startup behavior implemented by `src/server/main.ts`.

It is intentionally limited to the Game Server. Platform Server configuration is owned by that service, while the HTTP contract between the two services is defined by [`../api/platform-openapi.yaml`](../api/platform-openapi.yaml).

## 1. Development and production entrypoints

From `Game/`, source development still uses:

```bash
npm run server
```

which runs `tsx src/server/main.ts`.

The production build is created with:

```bash
npm run build
```

It creates one deployable `dist/` tree:

```text
dist/
├── build-manifest.json
├── client/
│   ├── index.html
│   └── assets/...
├── content/
│   ├── manifest.json
│   └── vsm-baseline-01/...
└── server/
    └── main.mjs
```

Start the compiled server with:

```bash
npm run start:server
```

or directly:

```bash
node dist/server/main.mjs
```

The server bundle includes its runtime npm dependencies and automatically discovers sibling `dist/client/` and `dist/content/` directories. A copied `dist/` tree therefore runs without project sources, `tsx`, or `node_modules`. `GAME_STATIC_DIR` and `GAME_CONTENT_DIR` remain explicit overrides.

Node requirement from `package.json`:

```text
Node >= 22.12.0
```

## 2. Environment variables

All process environment parsing is centralized in `src/server/config.ts`.

| Variable | Default | Required | Meaning |
| --- | --- | --- | --- |
| `GAME_SERVER_HOST` | `127.0.0.1` | no | HTTP/WS listen address. In containers normally set to `0.0.0.0`. |
| `GAME_SERVER_PORT` | `4174` | no | HTTP and WebSocket listen port. |
| `GAME_STATIC_DIR` | auto-detected `dist/client/` | no | Browser folder-root override. If set, it must exist and contain `index.html`; otherwise startup fails. |
| `GAME_CONTENT_DIR` | auto-detected `dist/content/` (`Game/content/` in source) | no | Read-only server gameplay bundle root containing `manifest.json`. Invalid/missing content fails startup. |
| `PLATFORM_API_URL` | unset | paired | Base URL of Platform Server API. Must be configured together with `PLATFORM_SERVICE_TOKEN`. |
| `PLATFORM_SERVICE_TOKEN` | unset | paired | Bearer token used by Game Server for service-to-service Platform calls. Treat as a secret. |
| `PLATFORM_TIMEOUT_MS` | `5000` | no | Timeout for one Platform HTTP request. |
| `GAME_DISCONNECT_DEBOUNCE_MS` | `1000` | no | Delay after socket detach before the attempt pauses. |
| `GAME_RECONNECT_GRACE_MS` | `30000` | no | Additional time a detached attempt remains available for resume before abort. |
| `GAME_SIMULATION_STEP_MS` | `50` | no | Technical worker wake-up cadence. It does not define simulation rules. |
| `GAME_MAX_CATCH_UP_MS` | `1000` | no | Maximum wall-clock gap that may be mapped as catch-up before re-anchoring. |
| `GAME_WS_MAX_PAYLOAD_BYTES` | `65536` | no | Maximum inbound WebSocket frame size. |
| `GAME_WS_MAX_BUFFERED_BYTES` | `262144` | no | Per-client outbound buffered byte budget before slow-client close. |
| `GAME_SHUTDOWN_GRACE_MS` | `5000` | no | Grace period before remaining connections are force-terminated during shutdown. |
| `GAME_LOG_LEVEL` | `info` | no | Pino level: `trace`, `debug`, `info`, `warn`, `error`, `fatal`, or `silent`. Use `debug` while investigating client/server integration and `trace` only for short tick-level captures. |
| `GAME_MOCK_ATTEMPT_ID` | `local-attempt` | mock only | Attempt ID returned by local mock PlatformGateway. |
| `GAME_MOCK_LEVEL_ID` | `vsm-baseline-01` | mock only | Level ID returned in local mock mode. |
| `GAME_MOCK_MODE` | `live` | mock only | `live` or `guided`. |

### Platform mode selection

The Game Server has two startup modes.

**Mock/local mode** is selected when both of these are absent:

```text
PLATFORM_API_URL
PLATFORM_SERVICE_TOKEN
```

**Platform-integrated mode** is selected when both are present.

Configuring only one of the pair is a startup error.

## 3. Network endpoints

One listener serves HTTP and WebSocket traffic.

Default bind:

```text
127.0.0.1:4174
```

Container bind should normally be:

```text
GAME_SERVER_HOST=0.0.0.0
GAME_SERVER_PORT=4174
```

Endpoints:

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Process liveness. Returns `200` with `{"status":"ok"}` while the process handles HTTP. |
| `GET /ready` | Readiness/draining state. Returns `200 {"status":"ready"}` while accepting new work, otherwise `503 {"status":"draining"}`. |
| `GET /...` | Static browser files when a client root is available: explicit `GAME_STATIC_DIR` or auto-detected sibling `dist/client/`. SPA fallback uses `index.html` for extensionless paths. |
| `WS /game-ws` | Game protocol v1. See [`../api/websocket-protocol.md`](../api/websocket-protocol.md). |

Readiness intentionally does not perform a live Platform Server dependency check. Temporary Platform unavailability should not by itself make the Game Server process unready.

## 4. Static browser client

Static hosting is optional.

### Combined Game Server + browser distribution

Build both client and server:

```bash
npm run build
```

The resulting `dist/` tree contains the Node server, browser client folder root, and server gameplay content bundle. When `node dist/server/main.mjs` starts, it automatically serves `dist/client/` if `GAME_STATIC_DIR` is unset.

An explicit override is still supported:

```text
GAME_STATIC_DIR=/custom/client
```

Any explicitly configured static directory is validated before listening and must contain `index.html`.

### Separate static hosting

Leave `GAME_STATIC_DIR` unset when the client is served by a reverse proxy, CDN, object storage, or another web container.

The browser still needs `/game-ws` routed to the Game Server. If client and Game Server are on different origins, CORS is not the relevant mechanism for the WebSocket upgrade; the deployment must provide a correct WebSocket URL/routing policy and origin/security policy separately.

## 5. Game content and media assets

Server-side gameplay configuration is now file-backed. `GAME_CONTENT_DIR` contains the versioned `manifest.json` plus Level, Scenario, Actions and Assessment JSON files. The shipped baseline lives in `Game/content/` and is copied to `dist/content/` by `npm run build`.

The runtime loads and validates the complete registry before opening the listener. Platform `gameLevelId` values are resolved only through this registry. See [`content-bundle.md`](content-bundle.md) for the exact release format and immutability rules.

Browser/media files remain a separate concern. `GAME_STATIC_DIR` is an ordinary folder root containing `index.html` and its assets; it does not need to follow the Game Server content-manifest format. Large visual/audio/text presentation assets may therefore be packaged with the client or served separately as long as stable projected `visualId` values remain compatible.

The client integration may introduce a dedicated HTTP file-storage namespace for browser-only assets. Its path/layout/manifest/cache contract is intentionally not fixed in release `0.1.0`; it should be defined from the actual client asset requirements rather than from simulation content structure.

## 6. Secrets and configuration ownership

Put in the **container image**:

- application source or compiled server artifact;
- pinned npm dependencies;
- immutable server content bundle if bundled;
- optionally the built browser client.

Put in **environment/config**:

- bind host/port;
- timing/transport limits;
- Platform API URL;
- mock-mode identifiers.

Put in a **secret store / secret environment injection**:

- `PLATFORM_SERVICE_TOKEN`;
- future service credentials/private keys.

Do not bake service tokens into the image or browser bundle.

## 7. Startup validation and failure behavior

Startup fails before listening when:

- an environment variable violates the Zod configuration schema;
- only one of `PLATFORM_API_URL` / `PLATFORM_SERVICE_TOKEN` is set;
- configured `GAME_STATIC_DIR` does not exist;
- configured static path is not a directory;
- configured static directory does not contain `index.html`;
- `GAME_CONTENT_DIR` has no valid `manifest.json` or one of its referenced files/configs is invalid.

Unknown `gameLevelId` is detected when a session is resolved against the already-loaded file content registry.

A deployment readiness probe should begin only after the process has bound the listener.

## 8. Shutdown behavior

`SIGINT` and `SIGTERM` initiate graceful shutdown.

The server:

1. stops reporting ready/accepting upgrades;
2. shuts down the protocol/session host;
3. closes active WebSockets with code `1001` (`server shutting down`);
4. cancels worker timers and resume state;
5. closes the HTTP server;
6. force-terminates remaining connections after `GAME_SHUTDOWN_GRACE_MS`.

Container orchestrators should send `SIGTERM` and allow at least the configured shutdown grace plus a small process-exit margin before issuing `SIGKILL`.

## 9. Logging

The Game Server writes structured JSON logs through Pino to stdout. Every record
contains `service: "vsm-game-server"`; subsystem records also carry a `component`
field and stable `event` name. Error records use Pino's standard `err` field.

`GAME_LOG_LEVEL=info` is the production default. For integration debugging use
`debug`; it includes protocol command summaries, public delta revisions and changed
entity positions. `trace` additionally records worker tick scheduling/execution and
should normally be enabled only for short captures.

Authentication material is never intentionally included in event fields. Pino also
redacts fields named `sessionKey`, `resumeToken`, `serviceToken` and HTTP
`authorization` as a second line of defence. Do not add complete protocol payloads
to log records.

For readable local development output use:

```bash
npm run server:pretty
```

This pipes the same structured server output through the development-only
`pino-pretty` formatter. `GAME_LOG_LEVEL=debug npm run server:pretty` is the
recommended mode while integrating the browser client. Production containers should capture the JSON stdout
stream directly. Do not require local log files or writable application
directories for normal release operation.

For event names and debugging recipes see [`server-logging.md`](server-logging.md).

## 10. Platform API behavior

Game Server calls Platform Server with:

```http
Authorization: Bearer <PLATFORM_SERVICE_TOKEN>
Content-Type: application/json
```

Current operations:

```text
POST /api/game/sessions/resolve
POST /api/game/sessions/{attemptId}/finish
```

See [`../api/platform-openapi.yaml`](../api/platform-openapi.yaml).

`finishSession` is idempotent at the contract level. The worker performs a bounded in-memory retry sequence for transient Platform `unavailable`/`timeout` failures while keeping the terminal attempt frozen in `finishing`. Durable retry/outbox persistence across process restarts remains deferred.

## 11. Current runtime state boundary

The following are currently in-memory and ephemeral:

- `GameSessionWorker` instances;
- active simulation state;
- resume-token registry;
- WebSocket attachments;
- pending timers;
- accepted input journal until finalization.

Persistent results belong to Platform Server after successful `finishSession`.

Consequences for deployment:

- restarting a Game Server currently loses live attempts;
- a resume token works only on the Game Server process that owns the corresponding worker;
- multi-instance deployments require session affinity/routing to the owning instance, or a future external worker registry/migration design;
- do not advertise transparent live-worker failover yet.

## 12. Minimal local commands

Mock mode, server only:

```bash
cd Game
GAME_SERVER_HOST=0.0.0.0 npm run server
```

Build the deployable server + client and run it:

```bash
cd Game
npm run build
GAME_SERVER_HOST=0.0.0.0 npm run start:server
```

The same artifact can be copied elsewhere and started with `node dist/server/main.mjs`.

Platform-integrated mode:

```bash
cd Game
GAME_SERVER_HOST=0.0.0.0 \
PLATFORM_API_URL=http://platform:8080 \
PLATFORM_SERVICE_TOKEN='<secret>' \
npm run server
```

For PowerShell, set the same values through `$env:NAME = 'value'` before `npm run server`.
