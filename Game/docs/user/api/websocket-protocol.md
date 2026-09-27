# Game WebSocket protocol v1

**Protocol version:** `1`
**Status:** implementation contract
**Endpoint:** `/game-ws`
**Transport:** WebSocket, JSON text frames only

This document describes the protocol currently implemented by `src/common/game-wire.ts`, `src/server/protocol-adapter.ts`, and the browser client. The Zod schemas in `src/common` remain the executable source of truth; this file explains their lifecycle and semantics.

## 1. Scope

The protocol connects the Browser Game Client to the authoritative Game Server.

It does not describe Game Server ↔ Platform Server HTTP calls; those are defined by `platform-openapi.yaml` and `architecture/platform-contract.md`.

The client receives public presentation state only. Hidden simulation state, traits, RNG state, action logits, internal event queues, assessment internals, and server-only content are not part of the wire contract.

## 2. Transport rules

- WebSocket endpoint: `/game-ws`.
- Application messages are UTF-8 JSON text frames.
- Binary application frames are rejected.
- Every application message contains `protocolVersion: 1`.
- Incoming frame size is bounded by `GAME_WS_MAX_PAYLOAD_BYTES` (default `65536`). Oversized input is closed by the WebSocket transport with code `1009`.
- Outbound buffering is bounded by `GAME_WS_MAX_BUFFERED_BYTES` (default `262144`). If the next frame would exceed the budget, the Game Server closes that client with `1013` (`client is too slow`) instead of delaying simulation or buffering without limit.

The protocol is not JSON-RPC. `requestId` correlates request/response-style commands; unsolicited state updates do not require a request ID.

## 3. Connection and authentication

A new socket starts unauthenticated. Its first valid application message MUST be `hello`.

`hello` MUST contain exactly one credential:

- `sessionKey` — a one-shot credential issued through the Platform launch flow; or
- `resumeToken` — a short-lived Game Server credential for reconnecting to an existing attempt.

New launch:

```json
{
  "protocolVersion": 1,
  "type": "hello",
  "requestId": "req-1",
  "sessionKey": "platform-session-key"
}
```

Reconnect:

```json
{
  "protocolVersion": 1,
  "type": "hello",
  "requestId": "req-2",
  "resumeToken": "game-server-resume-token"
}
```

On success the server sends `session-ready` with an authoritative snapshot and usually a fresh resume token:

```json
{
  "protocolVersion": 1,
  "type": "session-ready",
  "attemptId": "attempt-123",
  "resumeToken": "new-resume-token",
  "snapshot": {
    "protocolVersion": 1,
    "type": "snapshot",
    "state": { "...": "PublicGameState" }
  }
}
```

The browser bootstrap currently reads `sessionKey` from `?sessionKey=...`, removes it from the visible URL, and stores only the Game Server `resumeToken` for later reconnect.

A new connection attached to an already connected attempt replaces the previous socket. The previous socket is closed with code `1008` and reason `session resumed from another connection`.

### Authentication/protocol failures

| Condition | Server message | Close code |
| --- | --- | ---: |
| malformed JSON/schema or binary protocol payload | `error(code="invalid-message")` | `1007` |
| first message is not `hello` | no required error payload | `1008` |
| `hello` has zero or two credentials | `error(code="invalid-hello")` | `1008` |
| credential resolution fails | `error(code="authentication-failed")` | `1008` |
| `hello` is sent after authentication | `error(code="already-authenticated")` | `1008` |
| socket is no longer attached to its attempt | no required error payload | `1008` |

The current browser client blocks automatic reconnect after close codes `1007` and `1008`, or after receiving the terminal error codes above.

## 4. Public state

Durable state is represented by `PublicGameState`:

```text
attemptId
revision
timeUs
clock
mode
phase
termination
activeRegionIds
world
entities
```

### Public clock

```json
{
  "timeScale": 1,
  "paused": false
}
```

The baseline worker accepts time scales `1`, `2`, and `4`.

### Attempt phase

Current public phases are:

- `pre-departure`;
- `origin-stop`;
- `travel { nextStopIndex }`;
- `stop { stopIndex, stopId }`;
- `finished`.

### Public entities

A public entity contains:

```text
id
kind: player | passenger
appearanceId
position
heldItem?
```

Public positions are:

- `cell { cellId }`;
- `moving { edgeId, fromCellId, toCellId, startedAt, arrivesAt, progress }`;
- `attached { anchorId }`.

`heldItem`, when present, exposes only an item ID and `visualId`.

### Public world

The world projection contains visible regions, cells, directed edges, and world objects. It is presentation/navigation data and is not the complete server-side `LevelDefinition`.

## 5. Snapshot, revision, delta and resync

`revision` is the monotonic version of public presentation state.

A snapshot establishes a complete authoritative baseline:

```json
{
  "protocolVersion": 1,
  "type": "snapshot",
  "state": {
    "attemptId": "attempt-123",
    "revision": 17,
    "timeUs": 12000000,
    "clock": { "timeScale": 1, "paused": false },
    "...": "..."
  }
}
```

A delta is valid only when the client's current revision equals `baseRevision`:

```json
{
  "protocolVersion": 1,
  "type": "delta",
  "attemptId": "attempt-123",
  "baseRevision": 17,
  "revision": 18,
  "changes": {
    "entities": {
      "upsert": [],
      "removeIds": []
    }
  }
}
```

`entities.upsert` replaces an entity with the same ID; it is not append-only.

If a delta cannot be applied because the attempt or `baseRevision` differs, the client sends `resync`:

```json
{
  "protocolVersion": 1,
  "type": "resync",
  "requestId": "req-20",
  "knownRevision": 16
}
```

The server responds with a fresh `snapshot`. Protocol v1 intentionally has no delta ring buffer/replay.

Any accepted new revision invalidates a previously displayed `action-offer`. A snapshot also clears stale offers.

Pure idle wall-clock passage does not consume a public revision. Observable state changes, including public clock changes, do.

## 6. Client commands

Every command has `protocolVersion: 1` and a non-empty `requestId`.

Except `hello` and `resync`, current commands include `knownRevision`. Before interpreting an authenticated command, the worker synchronizes simulation to authoritative server wall time.

### `move-to`

```json
{
  "protocolVersion": 1,
  "type": "move-to",
  "requestId": "req-3",
  "knownRevision": 17,
  "targetCellId": "carriage:c12"
}
```

The server validates movement. The client does not update authoritative position locally.

### `query-actions`

```json
{
  "protocolVersion": 1,
  "type": "query-actions",
  "requestId": "req-4",
  "knownRevision": 18,
  "target": {
    "kind": "object",
    "objectId": "service-point"
  }
}
```

Targets can be `cell`, `entity`, or `object`. A stale revision is rejected instead of generating an offer.

### `invoke-action`

```json
{
  "protocolVersion": 1,
  "type": "invoke-action",
  "requestId": "req-5",
  "knownRevision": 18,
  "actionHandle": "opaque-runtime-handle",
  "input": {}
}
```

`input` is optional JSON. Its semantic shape is action-specific and validated server-side.

### `set-time-scale`

```json
{
  "protocolVersion": 1,
  "type": "set-time-scale",
  "requestId": "req-6",
  "knownRevision": 20,
  "scale": 2
}
```

Current baseline scales are `1`, `2`, and `4`. Unsupported scales are rejected.

### `resync`

Requests a complete snapshot. `knownRevision` is optional and diagnostic in the current implementation.

## 7. Command results

Accepted:

```json
{
  "protocolVersion": 1,
  "type": "command-result",
  "requestId": "req-5",
  "status": "accepted",
  "revision": 19
}
```

Rejected:

```json
{
  "protocolVersion": 1,
  "type": "command-result",
  "requestId": "req-5",
  "status": "rejected",
  "revision": 19,
  "code": "stale-revision",
  "message": "stale-revision"
}
```

Defined rejection codes:

- `stale-revision`;
- `unknown-action`;
- `invalid-input`;
- `action-rejected`;
- `unsupported-command`.

The current adapter maps most projection/action exceptions to `action-rejected`; consumers should rely on the schema instead of assuming every enum value is emitted by every action path.

When the browser receives `stale-revision`, it clears the current offer and requests `resync`.

An accepted client command may be followed by a delta. A delta may also arrive without any preceding command because simulation advances autonomously.

## 8. Action offers and handles

Successful `query-actions` returns:

```json
{
  "protocolVersion": 1,
  "type": "action-offer",
  "requestId": "req-4",
  "revision": 18,
  "target": {
    "kind": "object",
    "objectId": "service-point"
  },
  "actions": [
    {
      "handle": "opaque-runtime-handle",
      "uiKind": "interaction",
      "label": "Take drink",
      "target": {
        "kind": "object",
        "objectId": "service-point"
      }
    }
  ]
}
```

`uiKind` is one of `interaction`, `inspect`, `dialogue`, or `form`.

A `form` action may carry a browser-safe `form` descriptor. The current baseline uses:

```json
{
  "kind": "acceptance-journal",
  "value": {
    "communication": "unset",
    "extinguisher": "unset",
    "climate": "unset",
    "emergencyBrake": "unset",
    "sanitation": "unset",
    "note": "",
    "accepted": false
  }
}
```

The baseline also exposes `extinguisher-inspection` and `climate-control` forms. `climate-control` carries cached `temperatureC`, `pressureKPa`, `smokeDetected`, connection state and `updatedAt`; invoking it with `{ "refresh": true }` performs a server-side sensor refresh.

The client opens the corresponding form locally and submits the edited value through the same opaque action handle using `invoke-action.input`. The server validates the complete input schema; partial or malformed form values are rejected with `invalid-input`.

The handle is opaque. The client MUST NOT parse or synthesize it, persist it as a long-lived capability, or infer domain rules from it.

An offer is bound to its `revision`. Any revision change invalidates it, and invocation is always revalidated by the server.

## 9. Presentation events

Transient presentation effects use `presentation-event` and do not by themselves define durable authoritative state:

```json
{
  "protocolVersion": 1,
  "type": "presentation-event",
  "attemptId": "attempt-123",
  "at": 12500000,
  "sequence": 7,
  "event": {
    "kind": "speech",
    "entityId": "passenger-17",
    "text": "Можно воды?",
    "visible": true
  }
}
```

Current payload kinds:

- `hint` — optional text/target and presentation style `message | toast | highlight`;
- `speech` — entity text and visibility;
- `notification`;
- `achievement-unlocked`;
- `effect` — public `visualId` with optional target.

An event may also contain mode-specific `extensions: [{ type, data }]`.

`at` and `sequence` provide ordering metadata. The current contract does not promise replay of transient presentation events after reconnect; reconnect establishes a new durable snapshot.

## 10. Session state

Lifecycle changes outside ordinary state deltas use `session-state`:

```json
{
  "protocolVersion": 1,
  "type": "session-state",
  "attemptId": "attempt-123",
  "state": "finishing"
}
```

States are:

- `active`;
- `paused`;
- `finishing`;
- `finished`;
- `aborted`.

Successful Platform finalization publishes `finished` with a redirect URL:

```json
{
  "protocolVersion": 1,
  "type": "session-state",
  "attemptId": "attempt-123",
  "state": "finished",
  "redirectUrl": "https://platform.example/results/result-456"
}
```

`finishing` means simulation has terminated and the Game Server is finalizing the result with Platform Server.

If finalization fails, the current worker does not invent a successful result. It returns its lifecycle to `active` or `paused` and publishes that state. Automatic retry policy is not part of protocol v1.

## 11. Server errors

General protocol/session failures use:

```json
{
  "protocolVersion": 1,
  "type": "error",
  "requestId": "req-1",
  "code": "authentication-failed",
  "message": "..."
}
```

`requestId` is optional because some failures occur before a valid request can be identified.

Current adapter-level codes include:

- `invalid-message`;
- `invalid-hello`;
- `authentication-failed`;
- `already-authenticated`.

`error.code` is intentionally an open non-empty string. Clients should display/log unknown codes rather than crash.

## 12. Reconnect behavior

1. Initial launch connects using `sessionKey`.
2. `session-ready` returns a Game Server `resumeToken`.
3. The browser stores the resume token and drops the one-shot session key.
4. A disconnected socket is detached from the worker.
5. After disconnect debounce, the worker pauses; it is retained for reconnect grace.
6. Reconnect sends `hello(resumeToken)`.
7. Successful reconnect attaches to the same worker and receives a fresh `session-ready` snapshot.
8. Simulation resumes without replaying the disconnected wall interval as a large catch-up jump.

A resume token is scoped to the attempt/worker. It does not authorize starting a new attempt.

## 13. Autonomous simulation updates

The server advances simulation independently of WebSocket traffic. Scheduled scenario transitions, NPC decisions, movement completion, and other simulation events can therefore produce unsolicited deltas.

Clients MUST NOT assume:

- every delta corresponds to a local command;
- `connected` means simulation is necessarily advancing;
- disconnect means the attempt has ended;
- render FPS determines simulation time.

## 14. Compatibility

Protocol v1 uses the literal field:

```json
{ "protocolVersion": 1 }
```

Current Zod schemas reject another value.

Compatibility rules:

- additional `error.code` strings may be introduced because that field is deliberately open;
- new discriminated-union message/event kinds require schema/client support and should not be assumed compatible with an older v1 client unless explicitly designed as ignorable;
- required existing fields cannot be removed or renamed within v1;
- hidden simulation/domain data must not be exposed merely for client convenience.

A breaking wire change should increment `GAME_PROTOCOL_VERSION` and ship with an explicit client/server compatibility plan.

## 15. Minimal end-to-end flow

```text
Browser                         Game Server
   |                                 |
   |--- WebSocket /game-ws --------->|
   |--- hello(sessionKey) ---------->|
   |<-- session-ready + snapshot ----|
   |                                 |
   |--- move-to(rev=R) ------------->|
   |<-- command-result accepted -----|
   |<-- delta R→R+1 -----------------|
   |                                 |
   |--- query-actions(rev=R+1) ----->|
   |<-- action-offer ----------------|
   |--- invoke-action(handle) ------>|
   |<-- command-result accepted -----|
   |<-- delta ------------------------|
   |                                 |
   |<-- unsolicited delta -----------|  scheduled simulation event
   |                                 |
   |<-- session-state finishing -----|
   |<-- session-state finished ------|
```

For exact validation and field types, use `src/common/game-wire.ts` and its contract tests.
