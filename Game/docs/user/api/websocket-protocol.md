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
- `resumeToken` — an ephemeral, attempt-scoped Game Server credential for reconnecting to an existing attempt.

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
| another application frame arrives while `hello` authentication is still pending | no required error payload | `1008` |
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

The current release worker accepts time scales `1`, `2`, and `4`.

### Replay capabilities

For release `0.1.0` forward replay, `mode.kind = "replay"` advertises only capabilities that the current server actually implements:

```json
{
  "kind": "replay",
  "capabilities": {
    "seek": false,
    "speeds": [1, 2, 4],
    "entityInspection": false,
    "revealTraits": false,
    "revealActionScores": false,
    "revealAssessment": false
  }
}
```

The server recreates the recorded content version/root seed and replays the authoritative `userInputs` in `(at, sequence)` order. Replay authentication fails if the recorded `gameLevelVersion` or `simulationCompatibilityVersion` does not match the selected local content bundle. When the replayed simulation reaches a terminal state, playback stops locally and **does not** call Platform `finishSession` or create another official result. Seek/checkpoints and hidden-state inspection remain future protocol extensions.

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

`targetCellId` is the requested final destination, not necessarily an adjacent cell. The server resolves an authoritative route over the currently active grid, starts the first edge, and continues/re-routes at cell boundaries until the destination is reached or becomes unreachable. The client does not synthesize intermediate movement commands or update authoritative position locally.

While the route is active, ordinary unsolicited `delta` messages carry the player's successive `moving` positions (`edgeId`, `fromCellId`, `toCellId`, `startedAt`, `arrivesAt`, `progress`). On an edge boundary the next authoritative edge may start at the same simulation timestamp, so clients should render the sequence from public position updates rather than assume a mandatory stationary-cell frame between edges.

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

`input` is optional JSON. Its semantic shape is action-specific and validated server-side. For form actions the current release contracts are listed in section 8. A client MUST submit an action handle from the current revision. The server revalidates the offered action against current simulation state at invoke time; a handle can therefore be rejected even when the public revision has not changed. Mutating a previously received form descriptor locally does not mutate server state.

In `replay` mode, gameplay-affecting commands are rejected with `unsupported-command`. This currently applies to `move-to`, `query-actions`, and `invoke-action`. `resync` remains available, and `set-time-scale` is treated as playback control rather than gameplay input.

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

Release `0.1.0` scales are `1`, `2`, and `4`. Unsupported scales are rejected.

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

For an accepted mutating command, the server sends its `command-result` before the delta caused by that command. A delta may also arrive without any preceding command because simulation advances autonomously.

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

A `form` action carries a browser-safe descriptor. Protocol v1 currently defines five baseline form kinds.

| `form.kind` | Purpose | `invoke-action.input` |
| --- | --- | --- |
| `acceptance-journal` | pre-departure acceptance checklist | the complete journal value |
| `extinguisher-inspection` | inspect/prepare the extinguisher | `{ "removePin": boolean }` |
| `climate-control` | inspect cached climate/pressure sensors | `{ "refresh": boolean }` |
| `emergency-brake` | inspect, break seal, then activate | `{ "action": "remove-seal" | "activate" }` |
| `passenger-documents` | inspect ticket and identity document | `{ "decision": "admit" | "reject" }` |

### `acceptance-journal`

Descriptor/value and submitted input use the same complete shape:

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

Allowed values are `unset | ok | problem` for `communication`, `extinguisher`, `climate`, and `emergencyBrake`; sanitation is `unset | clean | issue`. `note` is limited to 1000 characters. The server requires the complete object rather than a partial patch.

### `extinguisher-inspection`

```json
{
  "kind": "extinguisher-inspection",
  "value": {
    "pin": "present",
    "seal": "intact",
    "pressure": "normal",
    "bodyDamage": "none",
    "used": false,
    "canRemovePin": true
  }
}
```

The mutable command is deliberately smaller than the descriptor:

```json
{ "removePin": true }
```

`canRemovePin` is presentation guidance only. The server revalidates held-item state, proximity/action ownership, and current revision when the handle is invoked.

### `climate-control`

```json
{
  "kind": "climate-control",
  "value": {
    "connection": "connected",
    "temperatureC": 22.4,
    "pressureKPa": 100.8,
    "smokeDetected": false,
    "updatedAt": 42000000,
    "canRefresh": true
  }
}
```

The values are the panel's last cached observation, not a continuously streamed sensor field. To request a server-side refresh:

```json
{ "refresh": true }
```

`connection` is currently `connected | disconnected`; disconnected/error behavior may be expanded without exposing hidden field state.

### `emergency-brake`

```json
{
  "kind": "emergency-brake",
  "value": {
    "seal": "intact",
    "activated": false,
    "canRemoveSeal": true,
    "canActivate": false
  }
}
```

Removing the seal and activating the brake are separate commands:

```json
{ "action": "remove-seal" }
```

After that command is accepted, public state/revision changes and the old action handle becomes stale. The client MUST query actions again before sending:

```json
{ "action": "activate" }
```

A successful activation terminates the attempt through the normal session lifecycle; it is not represented as a special transport close.

### `passenger-documents`

```json
{
  "kind": "passenger-documents",
  "value": {
    "passengerId": "passenger-17",
    "serviceClass": "comfort",
    "ticket": {
      "passengerName": "Иван Иванов",
      "train": "ВСМ-400",
      "date": "2026-09-27",
      "departureTime": "12:00",
      "carriage": "04",
      "seat": "12A",
      "documentType": "passport",
      "documentNumberMasked": "**1234",
      "qrCode": "ticket-public-code"
    },
    "identity": {
      "type": "passport",
      "passengerName": "Иван Иванов",
      "birthDate": "1990-01-01",
      "numberMasked": "**1234"
    },
    "canAdmit": true,
    "canReject": true
  }
}
```

Decision input:

```json
{ "decision": "admit" }
```

or:

```json
{ "decision": "reject" }
```

The server does not expose its expected/correct boarding decision in this descriptor. That value remains assessment/server state.

The client opens the corresponding form locally and submits through the same opaque action handle using `invoke-action.input`. The server validates the complete action-specific input schema; malformed form input is rejected with `invalid-input`.

The handle is opaque. The client MUST NOT parse or synthesize it, persist it as a long-lived capability, or infer domain rules from it.

An offer is bound to its `revision`. Any revision change invalidates it, and invocation is always revalidated by the server.

## 9. Presentation events

Protocol v1 reserves `presentation-event` for transient presentation effects that do not by themselves define durable authoritative state. The release `0.1.0` server does not currently emit this message type; the client may support the envelope ahead of server-side producers:

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

If Platform finalization fails, the worker does not invent a successful result and does not resume terminal simulation. It remains in `finishing`. Transient `unavailable`/`timeout` failures receive a small bounded server-side retry sequence; non-transient failures remain frozen for diagnosis or an explicit idempotent retry. Retry timing is an implementation detail, not part of protocol v1.

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
4. While that socket remains attached, the token remains valid for that live attempt; it does not expire merely because the player has been connected for longer than reconnect grace.
5. On disconnect the worker starts the token expiry window for `disconnect debounce + reconnect grace`.
6. After disconnect debounce, the worker pauses; it is retained for reconnect grace.
7. Reconnect sends `hello(resumeToken)`.
8. Successful reconnect attaches to the same worker, rotates the old token, and receives a fresh `session-ready` snapshot/token.
9. Simulation resumes without replaying the disconnected wall interval as a large catch-up jump.

A resume token is scoped to the attempt/worker. It does not authorize starting a new attempt. Entering terminal `finishing` revokes resume credentials because terminal simulation cannot be reattached.

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
