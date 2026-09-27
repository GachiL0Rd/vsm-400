# Game Server / Baseline implementation audit

**Audit date:** 2026-09-27  
**Scope:** authoritative simulation, projection/common protocol, Game Server lifecycle, baseline vertical slice  
**Reference:** `docs/user/vsm_baseline_vertical_slice.md` and linked normative docs.

## 1. Summary

The transport/session/server shell is substantially more complete than the gameplay baseline.
The project already has a usable authoritative execution spine:

```text
Platform session
  -> GameSessionWorker
  -> SimulationClock
  -> GameAttempt
  -> PublicGameProjection
  -> common wire protocol
  -> WebSocket
```

The strongest implemented baseline slice today is:

```text
connect -> authoritative movement -> route phase progression
        -> passenger spawn/despawn -> NPC request loop
        -> take food/drink -> give passenger -> finish/report
```

The largest gaps are no longer infrastructure primitives. They are integration of already existing
simulation primitives into `GameAttempt`/projection plus the game-specific assessment layer.

## 2. Coverage matrix

| Baseline requirement | State | Current implementation | Main gap |
|---|---|---|---|
| Platform auth / attempt creation | implemented | `PlatformGateway`, `GameSessionHost` | no major baseline gap |
| WebSocket auth/resume/resync | implemented | protocol v1 + resume registry | no major baseline gap |
| Server wall-clock runtime | implemented | `GameSessionWorker` + `SimulationClock` | operational persistence still in-memory |
| Graceful shutdown / limits / readiness | implemented | H3 transport hardening | no live-worker failover |
| Production server + embedded client build | implemented | `dist/server/main.mjs` + `dist/client` | bundle size is only a client optimisation issue |
| Level/grid/platform regions | implemented foundation | `LevelDefinition`, `SpatialWorld` | baseline map is intentionally tiny |
| Destination movement | partial | server-authoritative edge movement | public `move-to` currently accepts only an adjacent cell, not a route target |
| Route phases and stops | implemented | pre-departure -> origin -> travel/stops -> finish | passenger movement at stops is not physical |
| Passenger spawn/service classes | implemented | three baseline passengers and class traits | class entitlement is not used by assessment yet |
| NPC trait/action loop | implemented baseline | wait/request/consume + deterministic RNG | very small behavior vocabulary |
| Food/drink service | implemented | service point + held slot + give event | service windows do not currently gate/influence behavior |
| Acceptance journal state | integrated baseline | take world action -> self form -> validated edit -> return action | visual styling can still evolve |
| Journal deadline / acceptance result | integrated baseline | preDeparture is gated by completed/accepted/returned journal; technical `problem` triggers existing critical terminal rule | future assessment can compare declarations with observed world state |
| Extinguisher | primitive implemented | inspect/take/prepare/use in `ItemStore` | not exposed through `GameAttempt`; not connected to fire |
| Climate control | configuration only | level object exists | no runtime state, refresh action, observed-vs-actual reading |
| Emergency brake | configuration + terminal signal | object + terminal rule | no public action/object runtime invokes the signal |
| Driver communication | configuration only | level object exists | no inspection/call actions or state |
| Sanitation | configuration only | `sanitationLocations` | not projected to client; no journal comparison/assessment |
| Passenger ticket/passport | missing | none | no document state or admit/reject actions |
| Fire/pressure fields | primitive implemented | tested `FieldWorld` | not instantiated/advanced by `GameAttempt` |
| Baseline incident | missing | terminal rules exist | scenario does not schedule/drive an incident |
| Terminal outcomes | partial | `GameAttempt.signal()` + route completion | most signals have no gameplay source |
| Service plan windows | parsed only | scenario validates windows | runtime currently does not consume them |
| Dialogue/speech | protocol capability only | presentation event schema exists | simulation emits no dialogue/speech events |
| Assessment scores | missing | result shape exists | Game Server currently reports both scores as `0` |
| Achievements | missing | result shape/event schema exists | reports `setVersion: unimplemented`, empty IDs |
| Guided hints | contract only | guided mode + hint event schema | no coaching observer or hint production |
| Replay | contract/seed + input policy | replay mode resolves root seed and rejects gameplay input | no action-log playback/seek executor |
| Deterministic replay source | partial | seed + authoritative accepted command journal | replay executor/verification test is missing |

## 3. Server correctness blockers before adding more gameplay

### S1. Terminal finalization failure

`GameSessionWorker.finish()` currently returns from `finishing` to `active` or `paused` when
`PlatformGateway.finishSession()` rejects. The underlying `GameAttempt` is already terminal.
An active worker can therefore schedule another simulation tick against an attempt that is not
allowed to advance.

Required hardening:

- terminal attempts must never return to normal gameplay lifecycle;
- failed result delivery must retain the final result for an explicit retry/recovery path;
- add a test where `finishSession()` rejects once and ensure no simulation tick advances the
  terminal attempt.

### S2. Mode policy is not enforced at the command boundary

`SessionMode` is projected to the client, but replay currently does not reject gameplay commands.
This violates the documented invariant that replay is read-only except for playback controls.

Required hardening:

- explicit command/input policy in the server/projection boundary;
- tests proving live/guided accept gameplay input and replay rejects it;
- do not implement full replay in the same patch.

### S3. Full-run determinism is not tested

Individual RNG/event primitives have deterministic tests, but there is no golden test proving that:

```text
content version + root seed + authoritative user inputs
```

reproduce the same terminal state/result.

This should be added before relying on replay data as a compatibility contract.

## 4. Gameplay integration priorities

### B1. Pre-departure acceptance loop

Journal handling is now integrated through the public protocol:

```text
platform journal object
  -> take action
  -> click player
  -> journal form action
  -> validated checklist input
  -> return action
  -> preDeparture gate / critical terminal rule
```

Remaining work in this slice is to expose actual inspection actions for driver comms, extinguisher, climate, emergency brake and sanitation observations, then let assessment compare those facts with the player-authored journal. Inspecting an object must not auto-fill the journal.

### B2. Incident loop

Instantiate `FieldWorld` (or a deliberately simpler incident runtime) inside the attempt and connect:

```text
scenario incident
 -> visible fire/pressure state
 -> extinguisher/emergency action
 -> terminal/non-terminal outcome
```

Do not add more physics sophistication before this loop is playable.

### B3. Passenger documents

Add ticket/passport public document data plus authoritative admit/reject action. Keep hidden
correctness on the server.

### B4. Assessment and achievements

Replace placeholders in `finishedResult()` with a run-scoped observer/assessment result.
At minimum baseline completion must produce non-placeholder:

- safety `0..100`;
- customer satisfaction `0..100`;
- achievement set version;
- unlocked IDs.

### B5. Guided/replay behavior

After live baseline behavior is complete:

- coaching observers emit transient hints without changing simulation;
- replay consumes the recorded input journal and blocks gameplay input;
- optional inspection extensions remain separate from normal public state.

## 5. Test strengthening plan

### Tier A — server correctness (next)

1. Platform finish failure cannot resume terminal simulation.
2. Repeated/explicit finalization remains idempotent after a failed delivery attempt.
3. Replay mode rejects `move-to`, `invoke-action` and other gameplay commands.
4. Live/guided modes retain the same simulation result for identical seed + gameplay inputs.
5. Disconnect/pause during a running movement/action resumes without duplicated completion.

### Tier B — baseline scenario integration

1. Pre-departure full journal happy path: take -> inspect independently -> edit -> accept -> return.
2. Journal omitted/incomplete at deadline still advances according to scenario, but assessment records it.
3. Passenger boarding/service/end-of-route full authoritative run.
4. Waiting service request success and timeout paths produce deterministic consequences.
5. Extinguisher happy path and invalid order (use before prepare) through public action handles.
6. At least one incident can reach both a safe outcome and a failure outcome.

### Tier C — protocol/end-to-end

1. Production server smoke already covers static client + WS movement; extend it to one interaction.
2. Full baseline E2E over WS with deterministic accelerated clock.
3. Reconnect in the middle of movement/waiting action and resync to the same authoritative state.
4. Stale action handle after autonomous server delta is rejected.
5. Result sent to a fake Platform HTTP server matches OpenAPI and contains the expected replay source.

### Tier D — determinism/property checks

1. Same seed + same inputs -> byte-equivalent canonical terminal snapshot/result.
2. Different scheduler cadence -> same simulation result.
3. Different network publish cadence -> same simulation result.
4. Stable ordering for simultaneous scheduled events.
5. Content/reference validation fuzz/property tests for malformed level/scenario configs.

## 6. Definition of baseline-complete server

The Game Server should not be called baseline-complete until one automated test can execute the
following without reaching into simulation internals:

```text
platform resolve
 -> WS hello
 -> pre-departure journal/equipment inspection
 -> origin boarding/document decisions
 -> travel passenger service
 -> incident response
 -> route or terminal completion
 -> Platform finish
```

and assert:

- authoritative result scores are non-placeholder;
- achievement IDs are versioned;
- replay source is sufficient to reproduce the run;
- no hidden simulation state appeared in normal client projection.

