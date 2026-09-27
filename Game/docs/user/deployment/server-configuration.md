# Game Server configuration and startup

**Status:** implementation contract for the current server
**Date:** 2026-09-27

This document describes the configuration currently consumed by `src/server/config.ts` and the startup behavior implemented by `src/server/main.ts`.

It is intentionally limited to the Game Server. Platform Server configuration is owned by that service, while the HTTP contract between the two services is defined by [`../api/platform-openapi.yaml`](../api/platform-openapi.yaml).

## 1. Current entrypoint

From `Game/`:

```bash
npm run server
```

Current script:

```text
tsx src/server/main.ts
```

The repository currently has no separate compiled Node server artifact. `npm run build` builds the browser client with Vite; it does not replace the `tsx` server entrypoint.

For a quick container this means the image must currently include the dependencies needed by `npm run server`, including `tsx`. A later production packaging pass may add a dedicated server compile/bundle target and then use a smaller runtime-only image.

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
| `GAME_STATIC_DIR` | unset | no | Directory containing built browser client. If set, it must exist and contain `index.html`; otherwise startup fails. |
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
| `GET /...` | Static browser files only when `GAME_STATIC_DIR` is configured. SPA fallback uses `index.html` for extensionless paths. |
| `WS /game-ws` | Game protocol v1. See [`../api/websocket-protocol.md`](../api/websocket-protocol.md). |

Readiness intentionally does not perform a live Platform Server dependency check. Temporary Platform unavailability should not by itself make the Game Server process unready.

## 4. Static browser client

Static hosting is optional.

### Combined Game Server + browser image

Build the browser client:

```bash
npm run build
```

Vite writes the current client bundle to `Game/dist/`.

Start the Game Server with:

```text
GAME_STATIC_DIR=/app/Game/dist
```

The server validates that the configured directory exists and contains `index.html` before listening.

### Separate static hosting

Leave `GAME_STATIC_DIR` unset when the client is served by a reverse proxy, CDN, object storage, or another web container.

The browser still needs `/game-ws` routed to the Game Server. If client and Game Server are on different origins, CORS is not the relevant mechanism for the WebSocket upgrade; the deployment must provide a correct WebSocket URL/routing policy and origin/security policy separately.

## 5. Game content and media assets

### Current implementation

The baseline game content is currently code-backed by `BaselineContentRegistry`. The known baseline ID is:

```text
vsm-baseline-01
```

Therefore the current Game Server does **not** require a mounted content directory to start.

The browser currently uses local/public visual IDs and placeholder/rendering registries. A production external media manifest/download pipeline is planned but is not yet a server startup dependency.

### Future packaging boundary

When level/scenario/content definitions move to external versioned files, prefer one immutable mounted/read-only content bundle per image/release, for example:

```text
/app/content
```

Do not silently replace content for a running release if deterministic replay depends on its version.

Large image/audio assets may be served separately from gameplay content. Their manifest/version must remain compatible with public `visualId` values sent by the Game Server.

## 6. Secrets and configuration ownership

Put in the **container image**:

- application source or compiled server artifact;
- pinned npm dependencies;
- baseline immutable game content if bundled;
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
- configured static directory does not contain `index.html`.

Unknown `gameLevelId` is currently detected when a session is resolved and the local `BaselineContentRegistry` cannot resolve it.

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

Current logging uses process console output for startup/shutdown and errors. There is no structured production logging/metrics contract yet.

Containers should capture stdout/stderr. Do not require local log files or writable application directories for baseline operation.

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

There is currently no automatic retry loop at the PlatformGateway boundary. `finishSession` is designed to be idempotent at the contract level, but retry/outbox policy is intentionally deferred.

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

Build client and serve it from the same Game Server:

```bash
cd Game
npm run build
GAME_SERVER_HOST=0.0.0.0 GAME_STATIC_DIR="$PWD/dist" npm run server
```

Platform-integrated mode:

```bash
cd Game
GAME_SERVER_HOST=0.0.0.0 \
PLATFORM_API_URL=http://platform:8080 \
PLATFORM_SERVICE_TOKEN='<secret>' \
npm run server
```

For PowerShell, set the same values through `$env:NAME = 'value'` before `npm run server`.
