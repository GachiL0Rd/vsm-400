# Game server

`src/server` is the composition root for authoritative `simulation`, platform
integration, HTTP/static hosting and the WebSocket transport. Browser wire DTOs
remain in `src/common`; `CommonGameProtocolAdapter` connects them to the
`GameSessionWorker`/`PublicGameProjection` boundary.

Run the standalone server with `npm run server`. Without `PLATFORM_API_URL` and
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

Baseline live time scales are `1x`, `2x`, and `4x`. A clock/state change and any
simulation-originated public state change are projected through the same public
revision path as command-induced changes. Pure idle time does not invalidate
revision-bound action handles.

When the attempt reaches a terminal state, the worker sends `finishing`, calls
`PlatformGateway.finishSession()` idempotently, then sends `finished` with the
platform redirect URL.
