# Release gate 0.1.0 — Game Server

**Дата:** 2026-09-27
**Scope:** Game Server + authoritative simulation + release content bundle. Normative acceptance scope: [`../user/release-scope-0.1.0.md`](../user/release-scope-0.1.0.md). Platform Server and browser-client implementations are treated as correct consumers/providers of the documented contracts.

## Gate result

**Status: PASS for the current `0.1.0` release scope after the hardening changes in this gate.**

The release artifact can run as `server + content + client-root`, resolve a live attempt, execute the gameplay included in the current release scope, produce assessment/achievements, finish through Platform, and serve/reconnect over the documented WebSocket protocol.

## Release blockers found and fixed

1. **Replay mode silently did not replay.** The server accepted `mode=replay`, reused only the root seed, ignored `source.userInputs`, advertised unsupported seek/reveal capabilities, and could have finalized replay as a new Platform result.
   - Added validated forward replay of authoritative `{at, sequence, command}` records.
   - Added content/simulation compatibility checks before replay starts.
   - Replay never calls Platform `finishSession`.
   - Public capabilities now advertise only `1x/2x/4x` forward playback; seek/inspection/reveal are false.
   - Replay gameplay rejection now emits the documented `unsupported-command` code.

2. **Dead-code audit command was broken.** `npm run audit:dead-code` referenced a missing script.
   - Restored a cross-platform Knip wrapper with the constrained-environment setting.
   - Removed two actually unused dependencies (`heap-js`, `playwright`) and the unused projection barrel.
   - Added the audit to `npm run verify`.

3. **Resume-token rotation was too permissive.** Reconnects issued new tokens while older tokens for the same attempt remained usable until expiry and accumulated in memory.
   - Issuing a new token now revokes older tokens for that attempt.
   - Expired records are deleted on lookup.

4. **Persistent lint debt hid future warnings.** Three long-standing cognitive-complexity warnings were present in every verification run.
   - Refactored trait validation, heap sift-down and grid route construction without changing semantics.
   - `biome ci` is now warning-free.

## Gate coverage

The release gate checks:

- common-wire schema/type validation;
- deterministic simulation primitives, scenario progression, and a whole-baseline same-seed/same-input regression;
- journal, passenger documents, service interaction, fire, pressure/climate and emergency stop;
- assessment and achievement generation;
- WebSocket auth/resume/resync/action flows;
- replay input validation and forward playback;
- Platform resolve/finish boundary and idempotent finish behavior;
- disconnect pause/reconnect behavior;
- payload/backpressure/shutdown/readiness behavior;
- file content bundle loading and validation;
- production build, external content root, external client root and production WebSocket smoke;
- dead files/dependencies/unresolved imports/cycles.

## Accepted 0.1.0 limitations

These do **not** block the current `0.1.0` release scope, but should not be described as implemented features:

- Guided mode does not yet generate coaching/hint presentation events; it currently shares live simulation semantics and only exposes the requested hint policy.
- Replay is forward-only. Seek/checkpoints, hidden-state/entity inspection and assessment/action-logit reveal are not implemented.
- `servicePlan.windows` are parsed and validated content, but the current baseline action content does not consume them as automatic runtime effects. They should receive focused script/content tests before being relied on for gameplay behavior.
- Driver communication is not yet a gameplay interaction.
- Sanitation is represented in acceptance-journal state/assessment context, not as a separate spatial sanitation gameplay system.
- Attempts and resume tokens are in-memory. Process restart/live failover cannot preserve an active attempt.
- A transient Platform failure after terminal simulation leaves the worker safely frozen in `finishing`; automatic retry/backoff is intentionally not part of protocol v1.
- `move-to` remains an adjacent-cell command; client-side multi-cell path intent is not a server protocol feature in 0.1.0.

## Verification environment

The gate workspace passes `npm run verify`. A lockfile-matched Linux x64/glibc dependency bundle has also been validated with `npm ci --offline`, so the release candidate is reproducible from the provided bundle without changing `package-lock.json`. Normal CI should still perform the same clean-install + verify sequence before tagging.

## Post-gate recommendation

Before tagging, run a clean install and `npm run verify` in CI (networked registry or the verified offline bundle). If that is green, the current server state is suitable for the `0.1.0` release candidate. Deferred baseline capabilities remain incremental gameplay work rather than prerequisites for this release.
