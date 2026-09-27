# Integration hardening before protocol/deployment documentation

**Status:** planned  
**Date:** 2026-09-27  
**Scope:** first end-to-end browser ↔ game-server ↔ simulation contour after `common`, public projection, server skeleton and client foundation exist.

This checklist is intentionally narrower than the full baseline backlog. The goal is to make the current module boundaries reliable enough that API/deployment documentation can describe actual behavior rather than a moving target.

## Exit condition

Hardening is considered complete when a browser can authenticate, receive a public snapshot, issue authoritative commands, receive consistent deltas, reconnect with a resume token, continue while server-side simulation time advances, and observe final session state without relying on hidden demo behavior or client-side game rules.

The result does **not** require all baseline gameplay mechanics, replay UI, final art, incidents/assessment, or production infrastructure.

## H1 — Protocol correctness: complete

This batch should be completed before expanding visuals or documenting protocol examples.

- [x] **Client bootstrap/auth.** Browser obtains a `sessionKey` from its launch context, sends exactly one of `sessionKey | resumeToken` in the first `hello`, stores the returned `resumeToken`, and prefers it for reconnects. Missing/invalid authentication must have an explicit UI/network state rather than an endless reconnect loop.
- [x] **Canonical WebSocket endpoint.** Client and server use the same `/game-ws` endpoint; endpoint construction is centralized rather than repeated in presentation code.
- [x] **Correct delta upsert semantics.** Applying `entities.upsert` must replace an entity with the same ID instead of appending a duplicate. Add a regression test using player movement.
- [x] **Revision/resync behavior.** A mismatched delta or stale command must result in one predictable resync path. A snapshot must reset stale action offers and establish the new authoritative revision.
- [x] **Request/action-offer lifecycle.** `query-actions` offers are revision-bound; changing revision invalidates them; invoking an unknown/stale handle is rejected without mutating simulation.
- [x] **Wire validation/error handling.** Invalid JSON/schema payloads, binary payloads where unsupported, repeated `hello`, unauthenticated commands and unsupported commands must fail predictably without crashing a worker.
- [x] **Integrated contract test.** Cover `hello → session-ready/snapshot → move → delta → query-actions → action-offer → invoke-action → delta` through the same common schemas used by browser and server.

## H2 — Authoritative runtime/lifecycle: second batch

This is the main remaining server-integration gap. Simulation already supports explicit `advanceTo`; the worker must own wall-clock mapping and publication.

- [ ] **Worker simulation loop.** While active, map wall time to `SimTimeUs` and advance the attempt on a bounded cadence. Do not tie simulation semantics to render FPS or WebSocket traffic.
- [ ] **Pause/resume mapping.** Disconnect debounce/pause must stop advancement according to session policy and resume without a wall-time jump. Reconnect receives an authoritative snapshot before normal streaming continues.
- [ ] **Time-scale state.** Implement worker-owned time scale (at least baseline `1x`; optional supported scales can follow) and make `publicClock` truthful. `set-time-scale` either works according to policy or is intentionally absent from advertised capabilities.
- [ ] **Simulation-originated updates.** Changes caused by scheduled events/NPC decisions/scenario transitions must produce deltas even when no client command triggered them.
- [ ] **Single publication path.** Command-induced and clock-induced state changes use the same projection/revision machinery; no competing revision counters or direct serialization of simulation state.
- [ ] **Terminal transition.** When `GameAttempt` reaches termination, worker calls idempotent `finishSession` once, publishes `session-state: finishing/finished`, and exposes the platform redirect/result receipt without requiring another gameplay command.
- [ ] **Disconnect/reconnect lifecycle test.** Exercise active → detached → paused → resumed, plus expiry/abort behavior, with deterministic fake clock/scheduler.
- [ ] **Deterministic command journal.** Accepted gameplay commands retain authoritative simulation time/order suitable for the later replay source; rejected/stale commands are not recorded as accepted input.

## H3 — Transport/operational hardening: third batch

Do this before freezing deployment documentation, but keep it smaller than a production security project.

- [ ] **Backpressure policy.** Define a bounded policy for a slow WebSocket client. The simulation must never wait for socket drain; when incremental delivery is no longer safe, drop/coalesce and require a fresh snapshot/resync rather than buffering without limit.
- [ ] **Message limits.** Set explicit maximum WebSocket message size and reject unreasonable payloads before expensive parsing/processing.
- [ ] **Connection cleanup.** Closing/replacing a socket removes listeners/references and cannot leave a worker permanently attached to a dead connection.
- [ ] **Graceful shutdown.** HTTP/WS server stops accepting connections, closes active sockets/workers predictably, and exposes enough lifecycle to be used from a container entrypoint.
- [ ] **Health/readiness split.** Keep a cheap liveness endpoint and define readiness semantics that can detect invalid startup configuration/content. Do not make readiness depend on the external platform being permanently reachable unless deployment policy explicitly requires that.
- [ ] **Static-client/config behavior.** Missing static bundle, mock/platform configuration and startup errors fail clearly; `process.env` remains confined to the config/composition root.
- [ ] **Platform boundary robustness.** Preserve timeout/error mapping and idempotent finish semantics. Do not add retries that can duplicate effects unless retry/idempotency behavior is explicit.

## Explicitly outside this hardening pass

The following remain baseline/product work, not blockers for freezing integration contracts:

- full journal/extinguisher/climate/emergency-brake mechanics;
- assessment and achievements beyond stable placeholders;
- replay/guided implementation beyond current protocol extension points;
- final passenger/dialogue/modal UI;
- production asset pipeline;
- distributed persistence of live workers;
- multi-instance worker migration/failover;
- complete observability stack, rate limiting and production secret management.

## Documentation gate after H1–H3

Once the hardening batches above are stable, create and maintain the following normative integration documentation.

### D1 — WebSocket protocol reference

Target: `docs/user/api/websocket-protocol.md`.

Document the actual protocol implemented by `src/common` and the server adapter:

- endpoint and protocol version;
- connection/authentication lifecycle;
- first `hello`, `sessionKey`, `resumeToken`, reconnect and replacement connection rules;
- every client/server message and error code;
- revisions, snapshot/delta/resync semantics;
- `query-actions → action-offer → invoke-action` and handle lifetime;
- presentation events/session-state;
- time/pause/time-scale behavior;
- JSON examples and compatibility/versioning rules.

The document must follow schemas/tests; it must not become a second manually maintained protocol definition.

### D2 — Platform Server OpenAPI/Swagger

Targets:

- `docs/user/api/platform-openapi.yaml` — machine-readable OpenAPI contract;
- `docs/user/api/platform-contract.md` — lifecycle/semantic notes that are awkward to express in OpenAPI alone.

At minimum cover:

- `resolveSession`;
- `finishSession`;
- service authentication;
- contract versioning;
- session modes required by Game Server;
- idempotency/conflict behavior for finish;
- error responses/timeouts;
- `resultId` and validated redirect URL semantics.

This contract is intended to let the Platform Server developer work in a separate Git branch/repository without importing Game Server implementation code.

### D3 — Server configuration and container/deployment guide

Targets:

- `docs/user/deployment/server-configuration.md`;
- `docs/user/deployment/container-layout.md`;
- optional reference `Dockerfile`/Compose skeleton after the configuration contract is stable.

Describe enough to quickly assemble containers for Game Server, Platform Server and surrounding infrastructure:

- every Game Server environment variable and default;
- ports and HTTP/WS endpoints;
- static client/content/assets paths and volumes;
- mock/local mode versus Platform-integrated mode;
- startup/shutdown, liveness/readiness and logging expectations;
- service-to-service authentication inputs;
- network topology/reverse proxy assumptions;
- persistent versus ephemeral state boundaries;
- expected Platform/database/static-asset dependencies;
- a minimal local/container topology and a production-oriented topology without prescribing one cloud provider.

The deployment documentation should make it obvious which values belong in the image, environment, secret store, mounted content, or external service.

## Recommended execution order

1. H1 protocol correctness.
2. H2 authoritative runtime/lifecycle.
3. H3 transport/operational hardening.
4. D1 WebSocket reference.
5. D2 Platform OpenAPI + semantic notes.
6. D3 server/container/deployment documentation.

Keep each H batch as a separate reviewable patch unless the preceding batch reveals only trivial follow-up work.
