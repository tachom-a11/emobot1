# Architecture (overview)

JIMU-control is a **Windows-first Electron desktop app** that talks to a physical JIMU Master Brick over BLE and exposes a block-based editor + live control surface.

Deep dives:
- Device layer: `architecture/device-layer.md`
- Runtime & triggers: `architecture/runtime.md`
- Project format: `architecture/project-format.md`
- Protocol reference: `protocol.md`

## Experience surface (product)
- Project home: create/open projects, thumbnails, recent list.
- Model config: connect to brick, discover modules, test & calibrate.
- Blockly editor: routines/actions/triggers, variables, control flow.
- Controller: build widgets (buttons/sliders/joystick) and bind to code + keyboard/gamepad.
- Diagnostics: adapter check, firmware/battery, logs, reconnect status.

## High-level components
```mermaid
flowchart LR
  UI[React UI] -->|IPC| E[Electron main]
  UI --> R[Runtime (scheduler + triggers)]
  R --> SDK[JIMU SDK (jimu/)]
  E --> SDK
  SDK --> BLE[@abandonware/noble BLE]
  UI --> D[(Project storage)]
```

## Principles / constraints
- **One device API**: UI and runtime never touch BLE directly; everything goes through `jimu/`.
- **Non-blocking execution**: multiple actions can run in parallel (timers + triggers) without freezing UI.
- **Command pacing**: BLE writes must be throttled and notification parsing must handle concatenated frames.
- **RAM-first project state**: all user-editable project data must be stored in an App-level RAM state (not tab-local state) and only persisted to disk on explicit Project Save.

## Repository pointers
- SDK / device access: `jimu/jimu.js`, `jimu/jimu_ble.js`
- Reverse-engineering utilities: `probe/`
- Protocol notes and timing data: `protocol.md`, `scan_result.md`

## What to write next (to help implementation)
- Runtime interface (SDK API) that generated code can call: `architecture/runtime.md`
- Project schema and migrations: `architecture/project-format.md`
- Device abstraction and throttling rules: `architecture/device-layer.md`
