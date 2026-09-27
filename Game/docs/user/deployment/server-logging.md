# Game Server structured logging

Status: current release contract for diagnostics.

The server emits newline-delimited Pino JSON to stdout. Logs are diagnostic output,
not authoritative gameplay state and not part of the WebSocket protocol.

## Levels

- `info` — lifecycle and accepted gameplay operations: connection/authentication,
  worker creation/attach/detach, movement/action requests, terminal state and Platform finish.
- `debug` — command summaries, action offers, delta revision/change summaries,
  changed public entity positions, Platform request timing and deterministic input records.
- `trace` — worker tick scheduling/execution. Use only for short investigations.
- `warn` / `error` — rejected protocol operations, reconnect/Platform failures,
  catch-up clamps, retry exhaustion, transport backpressure and unexpected failures.

Set the level with `GAME_LOG_LEVEL`. For local readable output:

```bash
GAME_LOG_LEVEL=debug npm run server:pretty
```

Production should normally keep JSON output and let the container/runtime collect stdout.

## Correlation fields

Where applicable records include:

- `connectionId` — one WebSocket transport connection;
- `attemptId` — one authoritative game attempt;
- `requestId` — client command correlation id;
- `revision`, `baseRevision`, `knownRevision` — public projection ordering;
- `simulationTimeUs` — authoritative simulation time;
- `component` — `http-server`, `protocol`, `session-host`, `worker`, or `platform-gateway`.

Do not infer secrets from these identifiers. Session keys, resume tokens and Platform
service credentials are intentionally absent and additionally covered by Pino redaction.

## Movement investigation

A remote-cell click should produce a trace resembling:

```text
ws-command-received / move-to
move-request(targetCellId=...)
command-accepted(operation.kind=move-to)
gameplay-command-applied
delta-published(entityUpserts=[player moving edge A])
player-movement-progress(... edge/cell transitions ...)
delta-published(entityUpserts=[player moving edge B])
...
delta-published(entityUpserts=[player cell target])
```

The browser sends only the final `targetCellId`. The authoritative server chains the
route and public deltas expose each intermediate `moving`/`cell` position. If a route
becomes unavailable at a cell boundary the player remains in the last materialized
cell; the log therefore shows the last successful transition rather than a fabricated
client-side path.

For a stuck-between-cells report, compare the last server `delta-published` entity
position with the client's received/applied delta log using `attemptId`, `requestId`
and revision. If the server reached the next cell but the client did not, the fault is
a transport/client application issue. If the server stops publishing movement progress,
the worker/tick and simulation events around that timestamp are the next boundary.

## Emergency-brake investigation

The emergency brake has no autonomous server activation path. Activation can only
come through an accepted `invoke-action` that resolves to the recorded operation
`inspect-emergency-brake` with `action: activate`.

Relevant events are:

```text
action-offer-sent
action-invoke-request(actionHandle=..., input.action=...)
command-accepted(operation.kind=inspect-emergency-brake, operation.action=...)
gameplay-command-applied
terminal-detected
finish-start
```

This deliberately logs the normalized action kind/action but not the complete input
payload. If `terminal-detected` for the brake appears without the corresponding accepted
operation, treat that as a server invariant violation.

## Platform and reconnect investigation

Platform calls expose operation/path/status/duration and classified failure kind without
logging request bodies or credentials. Reconnect records distinguish session-key auth,
resume-token auth, stale sockets, takeovers, disconnect pause and reconnect-grace abort.

## Stable event vocabulary

The event names are intended to be grep/search friendly. Important groups include:

- transport: `http-request`, `ws-upgrade-*`, `ws-transport-error`, `ws-backpressure-close`;
- protocol: `ws-connection-*`, `ws-auth-*`, `ws-command-received`, `command-accepted`, `command-rejected`, `action-offer-sent`;
- host: `session-auth-*`, `session-resume-*`, `worker-created`, `worker-reused`, `worker-released`;
- worker: `worker-*`, `time-scale-changed`, `user-input-recorded`, `delta-published`, `player-movement-progress`, `terminal-detected`, `finish-*`;
- Platform: `platform-request-*`, `platform-session-resolved`, `platform-session-finished`.

Fields may be extended, but changing these names should be treated as a diagnostics
contract change because integration tooling and bug reports may rely on them.
