# Game server

`src/server` is the composition root for authoritative `simulation`, platform
integration, HTTP/static hosting and the WebSocket transport. Browser wire DTOs
remain in `src/common`; `CommonGameProtocolAdapter` connects them to the
`GameSessionWorker`/`PublicGameProjection` boundary.

For source development, run the standalone server with `npm run server`. For a
production-style distribution, `npm run build` creates `dist/server/main.mjs`,
`dist/client/`, and `dist/content/`; `npm run start:server` runs the compiled server.
The compiled server automatically discovers its sibling client/content directories unless
`GAME_STATIC_DIR` or `GAME_CONTENT_DIR` is explicitly configured. Without `PLATFORM_API_URL` and
`PLATFORM_SERVICE_TOKEN`, it uses `MockPlatformGateway`; configuration is read
once by `parseServerConfig`.

The server serves `GET /health`, optionally serves the static browser client,
and upgrades `/game-ws`. A worker belongs to an attempt rather than to a socket:
it survives reconnects within the configured grace period.

## Runtime timing

While an attempt is active, the worker maps a monotonic server wall clock onto
`SimTimeUs` with `SimulationClock` and advances the simulation on a technical
scheduler cadence. The cadence does not define game rules. Long scheduler stalls
are re-anchored instead of being replayed as unbounded catch-up.

Relevant configuration:

- `GAME_SIMULATION_STEP_MS` — worker wake-up cadence, default `50`;
- `GAME_MAX_CATCH_UP_MS` — maximum wall gap that may be caught up, default `1000`;
- `GAME_DISCONNECT_DEBOUNCE_MS` — delay before a detached active attempt pauses;
- `GAME_RECONNECT_GRACE_MS` — additional lifetime before an abandoned attempt aborts.

Release `0.1.0` live time scales are `1x`, `2x`, and `4x`. A clock/state change and any
simulation-originated public state change are projected through the same public
revision path as command-induced changes. Pure idle time does not invalidate
revision-bound action handles.

When the attempt reaches a terminal state, the worker sends `finishing`, calls
`PlatformGateway.finishSession()` idempotently, then sends `finished` with the
platform redirect URL.


## Transport and operations

Operational boundaries are intentionally small and explicit:

- `GET /health` is process liveness and does not depend on Platform Server reachability;
- `GET /ready` is `200` only while this process is accepting new HTTP/WS work;
- `/game-ws` limits one incoming frame to `GAME_WS_MAX_PAYLOAD_BYTES` (default `65536`);
- outbound WebSocket buffering is capped by `GAME_WS_MAX_BUFFERED_BYTES` (default `262144`). A client that cannot keep up is closed with `1013` instead of allowing unbounded memory growth;
- `GAME_SHUTDOWN_GRACE_MS` (default `5000`) bounds graceful socket draining before remaining connections are terminated;
- `SIGINT` and `SIGTERM` stop acceptance, close WebSockets with `1001`, cancel live worker timers/resume state, and close the HTTP server.

If `GAME_STATIC_DIR` is set, startup fails before listening unless the path is a
directory containing `index.html`. `GAME_CONTENT_DIR` must contain a valid content
manifest and referenced Level/Scenario/Actions/Assessment files; content is loaded
fail-fast before the listener opens. The browser client may still be served separately. Platform mode still requires
`PLATFORM_API_URL` and `PLATFORM_SERVICE_TOKEN` together; otherwise the server
starts in explicit mock mode.

Platform requests use the documented timeout/error mapping and the worker keeps
`finishSession` idempotent. Release `0.1.0` performs bounded in-memory retries for
transient finish failures (`unavailable` / `timeout`) while keeping the simulation
frozen in `finishing`. Durable retry/outbox recovery across process restarts remains
a deferred platform-integration capability.
