# Container and service layout

**Status:** deployment baseline / containerization guide
**Date:** 2026-09-27

This document describes service boundaries and reference container layouts. It does not mandate Docker Compose, Kubernetes, or a specific cloud provider.

## 1. Service boundaries

The baseline deployment contains three logical application surfaces:

```text
Browser
   |
   v
Reverse proxy / ingress
   |------------------------|
   v                        v
Game Server             Platform Server
   |                        |
   | HTTP service calls     v
   +--------------------> persistent database/storage
```

Optionally, browser/media assets can be split to static object storage/CDN:

```text
Browser ---- HTTPS ----> static client/assets
   |
   +---- WSS ---------> Game Server
   |
   +---- HTTPS -------> Platform Server UI/API
```

## 2. Game Server container

The Game Server owns one or more live game attempts in memory.

Exposed service interface:

```text
HTTP  /health
HTTP  /ready
WS    /game-ws
HTTP  static browser files (optional)
```

Outbound dependency in integrated mode:

```text
Platform Server HTTP API
```

No database is required by the current Game Server implementation.

### Filesystem expectations

The baseline process can run with a read-only application filesystem except for normal Node/runtime temporary requirements supplied by the base image.

Current server does not write authoritative persistent state to disk.

Possible read-only paths:

```text
/app/dist/server     compiled Game Server
/app/client          optional external browser folder root
/app/content         immutable server gameplay content bundle
```

## 3. Platform Server container

Platform Server is a separate service/repository owned by another developer/team.

For Game Server integration it must expose the contract in:

```text
docs/user/api/platform-openapi.yaml
```

The Game repository does not prescribe Platform Server language/framework.

Platform responsibilities include:

- user authentication/application UI;
- issuance/validation of game session keys;
- attempt identity and selected `gameLevelId`/mode;
- durable result storage;
- result page/redirect;
- its own database migrations and persistence lifecycle.

## 4. Reverse proxy / ingress

A reverse proxy is optional for local development but expected in most deployed topologies.

It should support WebSocket upgrades and route paths consistently. A simple same-origin layout can be:

```text
/                 -> Game Server static client OR static web service
/game-ws          -> Game Server WebSocket
/platform/...     -> Platform Server UI/API, if a shared origin is desired
```

The exact public Platform URL is a product/deployment choice. Do not rewrite Game protocol messages in the proxy.

Important proxy behavior:

- allow WebSocket upgrade for `/game-ws`;
- use timeouts suitable for long-lived WebSocket connections;
- preserve normal close behavior during draining;
- enforce TLS externally (`wss://`) for non-local deployments;
- optionally apply coarse request/rate limits before traffic reaches application processes.

## 5. Current single-instance affinity constraint

Live Game Server state and resume tokens are in memory.

Therefore a horizontally scaled deployment cannot send a reconnect to an arbitrary Game Server instance unless another routing/ownership mechanism is added.

Current safe choices are:

1. run one Game Server instance for the deployment/demo; or
2. route each attempt/resume token back to its owning Game Server using session affinity or an external routing registry.

Do not assume that replicas are interchangeable for an active attempt.

This restriction does not apply to Platform Server persistence, which is a separate concern.

## 6. Minimal container topology

For the current demo/integration environment:

```text
network: app

reverse-proxy (optional)
    -> game-server:4174
    -> platform-server:<platform-port>

game-server
    env:
      GAME_SERVER_HOST=0.0.0.0
      GAME_SERVER_PORT=4174
      PLATFORM_API_URL=http://platform-server:<platform-port>
      PLATFORM_SERVICE_TOKEN=<secret>
    health:
      /health
    readiness:
      /ready

platform-server
    env/config owned by Platform project
    -> database

database
    persistent volume
```

If Platform integration is not ready, omit `PLATFORM_API_URL` and `PLATFORM_SERVICE_TOKEN`; the Game Server then uses its explicit mock gateway.

## 7. Reference Game Server Dockerfile shape

`npm run build` now produces a self-contained application distribution under `Game/dist/`: a bundled Node server, browser folder root, and versioned server gameplay content bundle. A multi-stage image can therefore discard source files, dev dependencies, and `node_modules` from the runtime stage:

```dockerfile
FROM node:22-bookworm-slim AS build
WORKDIR /app/Game

COPY Game/package.json Game/package-lock.json ./
RUN npm ci
COPY Game/ ./
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
COPY --from=build /app/Game/dist ./dist

ENV GAME_SERVER_HOST=0.0.0.0
ENV GAME_SERVER_PORT=4174

EXPOSE 4174
CMD ["node", "dist/server/main.mjs"]
```

The compiled server auto-discovers `dist/client/` and `dist/content/`; `GAME_STATIC_DIR` and `GAME_CONTENT_DIR` override those locations. The runtime image therefore needs Node and `dist/`, but no npm install.

`npm run test:production` additionally starts the compiled server in an isolated temporary directory with client and server-content supplied as independent folder roots. This verifies that runtime does not depend on project sources or `node_modules` and that both deployment overrides work.

## 8. Reference Compose shape

A minimal topology can be expressed approximately as:

```yaml
services:
  game-server:
    build: .
    environment:
      GAME_SERVER_HOST: 0.0.0.0
      GAME_SERVER_PORT: 4174
      PLATFORM_API_URL: http://platform-server:8080
      PLATFORM_SERVICE_TOKEN: ${PLATFORM_SERVICE_TOKEN}
    expose:
      - "4174"
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:4174/health').then(r=>{if(!r.ok)process.exit(1)})"]

  platform-server:
    image: <platform-image>
    expose:
      - "8080"
    depends_on:
      - database

  database:
    image: <database-image>
    volumes:
      - platform-data:/var/lib/<database>

volumes:
  platform-data:
```

This snippet intentionally leaves Platform Server and database images unspecified. They belong to the Platform project.

For a production deployment, use a separate readiness probe against `/ready`; the example healthcheck above is only liveness.

## 9. Static client deployment options

### Option A — inside Game Server image

- run `npm run build` during image build;
- copy the resulting `dist/` tree into the runtime image;
- start `node dist/server/main.mjs`;
- proxy `/` and `/game-ws` to Game Server.

Advantages: simplest demo deployment.

Trade-off: every client asset change rebuilds/redeploys Game Server image.

### Option B — separate static image/CDN

- build `Game/dist/client` separately or extract it from the normal `npm run build` result;
- publish that client directory through nginx/object storage/CDN;
- route `/game-ws` to Game Server.

Advantages: browser assets can deploy independently.

The client protocol must remain compatible with the deployed Game Server protocol version.

## 10. Content and asset volumes

Baseline gameplay content is now external versioned JSON copied to `dist/content/`. It may instead be mounted independently through `GAME_CONTENT_DIR`. Recommended separation is:

```text
/content    immutable/versioned server gameplay content
/client     browser folder root (index.html + assets)
```

Simulation content affecting replay/determinism should be immutable for a released content version.

Large media may be deployed independently as long as the client asset manifest remains compatible with public `visualId` values.

## 11. Persistence matrix

| Data | Current owner | Persistent? |
| --- | --- | --- |
| user/profile/auth | Platform Server | yes |
| attempt identity | Platform Server | yes |
| live `GameAttempt` state | Game Server memory | no |
| resume tokens | Game Server memory | no |
| accepted input journal during run | Game Server worker | no until finish |
| final scores/result | Platform Server after finish | yes |
| baseline game content | Game Server content bundle | immutable deployment artifact |
| browser bundle | Game Server/static service | immutable deployment artifact |
| visual media | client/static layer | deployment artifact |

## 12. Shutdown and rolling deployment

Before terminating a Game Server instance, the orchestrator should:

1. remove it from new traffic/readiness routing;
2. send `SIGTERM`;
3. allow at least `GAME_SHUTDOWN_GRACE_MS` plus a small margin;
4. then force kill only if necessary.

Current shutdown aborts in-memory workers; it does not migrate them to another replica. Therefore zero-loss rolling migration of live attempts is **not implemented**.

For demos this is acceptable. Production continuity would require one of:

- draining until active attempts finish;
- durable worker checkpoints/recovery;
- externalized worker ownership/state;
- explicit user-visible interruption/restart policy.

## 13. Security boundary

Minimum deployment expectations:

- TLS termination for public HTTP/WebSocket traffic;
- `PLATFORM_SERVICE_TOKEN` injected as a secret and never exposed to browser code;
- Platform Server validates its own user authentication before issuing a SessionKey;
- Game Server trusts only the Platform service contract for starting new attempts;
- reverse proxy and infrastructure may add connection/request rate limits;
- container filesystem and service account should be least-privilege/read-only where practical.

Production secret rotation, mTLS, WAF rules, audit logging, and distributed rate limiting are outside the current baseline.

## 14. What is intentionally not standardized yet

The current docs do not mandate:

- Docker versus another OCI builder;
- Docker Compose versus Kubernetes/systemd/Nomad/etc.;
- Platform Server implementation language;
- database product;
- cloud vendor;
- distributed Game Server worker migration;
- external observability stack;
- asset CDN/provider.

Those choices should be layered on top of the stable service boundaries rather than imported into simulation or wire contracts.
