# Project format (save/load)

## Goals
- Human-debuggable files (git-friendly where possible)
- Versioned schema (migrations later)
- Assets (images/sounds) stored alongside the project

## Proposed on-disk layout
```
MyProject/
  project.json
  control/
    panel.json
  routines/
    main.xml
    drive.xml
  actions/
    wave.json
  assets/
    thumbnail.png
    panel-background.png
```

## `project.json` (proposal)
- Metadata: name, description, created/updated, schemaVersion
- Hardware target: preferred brick id/name (optional)
- Model snapshot: last accepted module discovery/status
- Calibration/settings: servo/motor limits + modes
- Variables: initial values + types
- Triggers: mapping of Trigger → [Routine | Action]
- Control panel: grid/layout + widget definitions/bindings
- Routines: list of `{ id, name, createdAt, updatedAt }` (XML lives in `routines/<id>.xml`)

## Model snapshot (from Model Config tab)
Model Config maintains a “hardware snapshot” inside the project so the rest of the app (Actions/Routines/UI) can:
- know which modules exist and which are currently missing
- apply per-servo/motor limits and calibration
- detect composition changes (current implementation uses status colors; explicit accept/reject flow is planned)

Save behavior for module changes:
- `missing` (gray): removed from the saved snapshot on Save (pruned)
- `new` (blue): added to the saved snapshot on Save
- `error` (red): must remain in the saved snapshot because it is referenced by Actions/Routines
  - note: the `error` (red) state becomes actionable once Actions/Routines can reference modules

### Proposed fields
- `hardware.connectedBrick`: last connected brick id/name
- `hardware.firmware`: firmware string (from status)
- `hardware.battery`: last-known `{ volts, charging }` (in RAM only; not stored)
- `hardware.modules`: last accepted module discovery/status (IDs + masks)
  - `servos`, `motors`, `ir`, `ultrasonic`, `eyes`, `speakers`
  - `detectedStatus`: per-module status (in RAM only)
      - `detected`: in save and detected (green)
      - `missing`: in save but not detected; safe to remove only if unused (gray)
      - `error`: in save, not detected, but used by Routines or Actions; cannot be removed (red)
      - `new`: not in save but currently detected (blue)
- `calibration.servoConfig[id]`:
  - `mode`: `servo` | `motor` | `mixed`
  - `min`, `max` (degrees -120..120), default -120..120
  - `maxSpeed` (1..1000 for continuous rotation), default 1000
  - `reverse` (bool) - if true: reverse direction in motor mode; invert position in servo mode (`pos = 240 - pos`)
- `calibration.motorConfig[id]`:
  - `maxSpeed` (1..150), default 150
  - `reverse` (bool) - if true: reverse direction in driving this motor

Example (sketch):
```json
{
  "schemaVersion": 1,
  "name": "MyProject",
  "description": "My first 2 wheel drive crab.",
  "hardware": {
    "connectedBrick": { "id": "aa:bb:cc", "name": "JIMU2" },
    "firmware": "Jimu_p1.79",
    "modules": {
      "servos": [1, 2, 3],
      "motors": [1, 2],
      "ir": [1],
      "ultrasonic": [1],
      "eyes": [1],
      "speakers": []
    }
  },
  "calibration": {
    "servoConfig": {
      "1": { "mode": "servo", "min": -120, "max": 120, "reverse": false, "maxSpeed": 1000 },
      "2": { "mode": "motor", "min": -120, "max": 120, "reverse": false, "maxSpeed": 1000 },
      "3": { "mode": "motor", "min": -120, "max": 120, "reverse": false, "maxSpeed": 1000 }
    },
    "motorConfig": {
      "1": { "maxSpeed": 150, "reverse": false },
      "2": { "maxSpeed": 150, "reverse": true }
    }
  }
}
```

## `panel.json` (proposal)
TBD.

## Variables (shared runtime state)
Variables are **global per project** and shared between routines in real time (so two concurrently running routines can communicate).

- Store variable values in `project.json` under `variables` (keyed by variable name), e.g. `variables: { "speed": 0, "enabled": true }`.
- Runtime values live in memory while the app is running and are keyed by **variable name**; Project Save persists the current RAM values to disk.
- Rename should be avoided/disabled because other routines may depend on the variable name.
- Deleting a variable should be blocked if it is referenced by any routine other than the current one.
