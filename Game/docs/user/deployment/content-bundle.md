# Game Server content bundle

**Status:** release configuration contract
**Date:** 2026-09-27

Game Server gameplay configuration is loaded from a read-only versioned content directory at process startup. Browser/media files are not part of this bundle.

## 1. Directory boundary

The server reads `GAME_CONTENT_DIR`. In the production distribution it auto-discovers `dist/content/`; in source development it auto-discovers `Game/content/`.

The shipped baseline layout is:

```text
content/
├── manifest.json
├── vsm-baseline-01/
│   ├── level.json
│   ├── scenario.json
│   ├── actions.json
│   ├── hints.json
│   └── assessment.json
└── vsm-train2-01/
    ├── map-bindings.json
    ├── level.json
    ├── scenario.json
    ├── actions.json
    ├── hints.json
    └── assessment.json
```

`GAME_CONTENT_DIR` may point at another read-only directory with the same contract. Manifest paths must be relative and may not escape that root.

## 2. Manifest

`manifest.json` maps the external Platform `gameLevelId` to one complete simulation bundle:

```json
{
  "schemaVersion": 1,
  "bundles": [
    {
      "gameLevelId": "vsm-baseline-01",
      "gameLevelVersion": "vsm-baseline-01",
      "simulationCompatibilityVersion": "0.1.0",
      "level": "vsm-baseline-01/level.json",
      "scenario": "vsm-baseline-01/scenario.json",
      "actions": "vsm-baseline-01/actions.json",
      "hints": "vsm-baseline-01/hints.json",
      "assessment": "vsm-baseline-01/assessment.json"
    },
    {
      "gameLevelId": "vsm-train2-01",
      "gameLevelVersion": "vsm-train2-01",
      "simulationCompatibilityVersion": "0.1.0",
      "level": "vsm-train2-01/level.json",
      "scenario": "vsm-train2-01/scenario.json",
      "actions": "vsm-train2-01/actions.json",
      "hints": "vsm-train2-01/hints.json",
      "assessment": "vsm-train2-01/assessment.json"
    }
  ]
}
```

`gameLevelId` is the lookup key supplied by Platform Server. `gameLevelVersion` and `simulationCompatibilityVersion` are written to the finished result and therefore must remain stable for a released bundle.

Duplicate `gameLevelId` values are rejected at startup.

## 3. Files inside one bundle

### `level.json`

Canonical `LevelDefinition` data: regions, grid cells/edges, anchors, interactable world objects, failure locations, and sanitation locations. It is parsed by `levelDefinitionSchema` and reference validation before the server starts accepting sessions.

`vsm-baseline-01/level.json` is a small hand-authored grid. `vsm-train2-01/level.json` is generated. Do not edit it by hand. `content/vsm-train2-01/map-bindings.json` holds the semantics the Tiled art does not carry, and `npm run map:build` writes the level from `assets/map/train2-long.tmx`. `npm run map:check` regenerates that level in memory and fails when the committed file differs. The same command also checks the finite client map `src/client/assets/map/train2-long.map.json`, which the Phaser client loads when a public region visual id starts with `map.train2-long`. `map-bindings.json` is authoring input, not a file the content registry loads.

### `scenario.json`

Canonical `ScenarioDefinition` data: pre-departure, route/stops, passenger documents and expected decisions, service windows, incidents, and terminal rules. It is parsed by `scenarioDefinitionSchema` and validated against the loaded Level.

Simulation times in canonical JSON are integer microseconds (`*Us`). Authoring tools may expose friendlier units, but the release bundle contains canonical values.

### `actions.json`

Serializable NPC action/trait content consumed by `loadActionContent`: action definitions, trait modifiers, and base action lists. Handler names reference compiled server handlers; arbitrary executable code is not loaded from content.

### `hints.json`

Coaching copy for guided sessions. Parsed by `hintContentSchema` (`schemaVersion: 1`) before the server accepts sessions. Both shipped bundles carry the same catalog. The observer emits nothing from this file in live or replay mode.

Each entry has a stable `id` (the wire `hintId`), a `trigger`, a `role` (`suggestion`, `attention`, or `feedback`), and a presentation of `message` or `toast`. `highlight` is not a parent presentation: `journal-taken` lists child highlights with their own ids and object ids.

Triggers:

| `id` | `trigger` | When it fires |
| --- | --- | --- |
| `attempt-start` | `attempt-start` | First guided capture. Message, target `acceptance-journal`. |
| `journal-taken` | `journal-taken` | Journal is held and not yet filled. |
| `highlight-extinguisher`, `highlight-emergency-brake`, `highlight-climate-control`, `highlight-driver-comms` | children of `journal-taken` | Same moment, only when highlights are enabled. |
| `journal-filled` | `journal-filled` | Checklist is complete, accepted, and not submitted. |
| `meet-passengers` | `meet-passengers` | Journal submitted, or the origin stop has started. |
| `passenger-waiting` | `passenger-request-unhandled` | `request-drink` or `request-food` is still open `afterUs` later (30s). Target is that passenger. Once per request occurrence. |
| `feedback-false-journal` | `feedback-false-journal` | Submitted journal is a false critical report. |
| `feedback-unsafe-admit` | `feedback-unsafe-admit` | Admitted a passenger who should have been rejected. |
| `feedback-wrong-reject` | `feedback-wrong-reject` | Rejected a passenger who should have been admitted. |
| `feedback-false-emergency-brake` | `feedback-false-emergency-brake` | Brake activated with no active safety hazard. |
| `inactivity` | `inactivity` | No gameplay command for `afterUs` (60s) during pre-departure. Repeatable. Text is copied from the current objective hint. |

Object ids in the catalog must exist in that bundle's level. Request action ids must exist in `actions.json`. A duplicate hint id or trigger fails startup.

### `assessment.json`

Versioned assessment tuning. Baseline v2 currently configures:

- starting score;
- penalties for incorrect boarding decisions;
- service response targets and penalties per class;
- critical fire/pressure penalties;
- false emergency-stop/seal penalties;
- false critical journal report and missed critical problem penalties;
- safe pre-departure minimum safety score;
- fast-fire-response threshold;
- achievement set version.

Changing assessment values therefore does not require recompiling the Game Server, but changing a released bundle should produce a new content/assessment version rather than silently replacing historical rules.

## 4. Startup behavior

The content registry is loaded before the HTTP/WebSocket listener is opened. Startup fails when:

- `manifest.json` is missing or invalid;
- a referenced file is missing or invalid JSON;
- a manifest path is absolute or escapes `GAME_CONTENT_DIR`;
- duplicate `gameLevelId` values exist;
- Level/Scenario validation fails;
- action content is invalid;
- hint content is invalid;
- assessment schema validation fails.

An unknown `gameLevelId` supplied later by Platform Server rejects that session instead of selecting an arbitrary fallback.

## 5. Release immutability

A running release treats its server content bundle as immutable/read-only. Do not edit files underneath a process that already owns active attempts.

For deterministic replay and result interpretation, retain the exact content bundle associated with its recorded `gameLevelVersion` and `simulationCompatibilityVersion`.

## 6. Browser/client assets are separate

The server content bundle contains gameplay data, not browser files.

The browser build is an ordinary folder root:

```text
client-root/
├── index.html
└── assets/
```

It can be supplied with `GAME_STATIC_DIR`, served from the bundled `dist/client/`, or hosted independently by nginx/CDN/object storage. The only compatibility boundary is the public protocol and stable visual IDs referenced by projected game state.
