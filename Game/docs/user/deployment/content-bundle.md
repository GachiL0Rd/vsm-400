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
└── vsm-baseline-01/
    ├── level.json
    ├── scenario.json
    ├── actions.json
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
      "assessment": "vsm-baseline-01/assessment.json"
    }
  ]
}
```

`gameLevelId` is the lookup key supplied by Platform Server. `gameLevelVersion` and `simulationCompatibilityVersion` are written to the finished result and therefore must remain stable for a released bundle.

Duplicate `gameLevelId` values are rejected at startup.

## 3. Files inside one bundle

### `level.json`

Canonical `LevelDefinition` data: regions, grid cells/edges, anchors, interactable world objects, failure locations, and sanitation locations. It is parsed by `levelDefinitionSchema` and reference validation before the server starts accepting sessions.

### `scenario.json`

Canonical `ScenarioDefinition` data: pre-departure, route/stops, passenger documents and expected decisions, service windows, incidents, and terminal rules. It is parsed by `scenarioDefinitionSchema` and validated against the loaded Level.

Simulation times in canonical JSON are integer microseconds (`*Us`). Authoring tools may expose friendlier units, but the release bundle contains canonical values.

### `actions.json`

Serializable NPC action/trait content consumed by `loadActionContent`: action definitions, trait modifiers, and base action lists. Handler names reference compiled server handlers; arbitrary executable code is not loaded from content.

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
