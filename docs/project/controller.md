# Controller (Control Panel Designer)

This document specifies Milestone 4: a **Controller** tab that lets the user design a control panel (design mode) and then run it (run mode) to trigger routines and provide live inputs to running routines.

## Goals
- Create a **grid-based control panel** with draggable/resizable widgets (design mode).
- Switch to **run mode** where the layout is locked and widgets are interactive.
- Allow multiple routines to run **in parallel** (background execution).
- Allow routines to read controller widget state via `getSlider(name)`, `getJoystick(name, axis)`, `getButton(name)`.

## Grid (touch-first)
- Virtual grid: **32x32 px**.
- Widgets snap to the grid for both **move** and **resize**.
- Widgets can be placed **anywhere on the grid** (no auto-compaction to top).
- Run mode: widgets are **not movable/resizable**.

### Default widget sizes (grid units)
- Button: **2x1**
- Switch: **2x1** (alternate layout allowed: **1x2**)
- Slider: **2x6** (default orientation: vertical)
- LED: **2x2**
- Display: **4x3**
- Joystick: **4x4** (must stay square); active knob: **32x32 px**, centered by default
- Timer: **1x1**

## MVP widget set (well-defined elements)
We intentionally limit the widget library to a small, well-defined set:
- **Joystick**: 2-axis (x/y) joystick.
- **Slider**: horizontal and vertical (with optional keyboard/gamepad stepping).
- **Button**
- **Switch**
- **LED indicator**: small round/square color blob (display-only).
- **Display**: number/text presenter (display-only).

Cross-platform requirement:
- Must work in Electron (Windows/macOS) and in a browser on mobile (Android/iOS).

## Library selection (recommended)
Use:
- **react-grid-layout** (MIT) for the grid designer (Design/Run mode toggle).
- Joystick implemented with **Pointer Events** (touch + mouse) (no extra dependency).

Everything else can be implemented with simple components:
- Button: `<button>`
- Switch: checkbox-style input or Radix Switch
- Slider: `<input type="range">` (current implementation)
- LED: `<div>` with background color + border radius
- Display: `<div>` text/number

## Recommended open source libraries

### Grid / layout (React)
Primary recommendation:
- **react-grid-layout** (MIT)
  - Very common for dashboard-like UIs.
  - Supports drag + resize, responsive layouts, grid snapping.
  - Natural fit for “Design/Run” mode (toggle `isDraggable` / `isResizable`).
  - Compatible with Electron (Windows/macOS) and browsers (Android/iOS).

Alternatives:
- **Gridstack.js** (MIT) (with a React wrapper or manual integration)
  - Mature drag+resize grid system; works great in plain DOM.
  - More imperative API; React integration may require extra care.
- **react-rnd** (MIT)
  - Drag+resize elements freely (not grid-first).
  - If we want strict grid snapping + responsive layout, it’s more work than `react-grid-layout`.

### Drag/drop from a palette
- **dnd-kit** (MIT) for “drag widget type from a toolbox into the grid”.

### Joystick widget
- Use a custom joystick based on **Pointer Events**:
  - returns normalized values `x,y` in `[-1..1]`
  - limiter shape: `round` (default) or `square` (allow corners, so `x=1` and `y=1` possible)
  - on release/cancel, returns to `{x:0, y:0}`
  - touch-first: `touch-action: none` on the joystick zone

### Keyboard / Gamepad triggers
- Keyboard: browser events (`keydown`/`keyup`) are enough for MVP.
- Gamepad: standard Web Gamepad API (no dependency needed).

## Design mode vs Run mode

### Design mode
- Show grid points
- Grid shows drop targets.
- Widgets can be moved/resized.
- Clicking a widget opens its configuration (name, behavior, bindings).
- No routines are triggered automatically (unless explicitly testing a widget).

### Run mode
- Layout is locked (no move/resize).
- Widgets are interactive and publish their live state to a **Controller State Store**.
- Widget events can start routines via bindings.
- If the brick is disconnected, the top bar shows a red **JIMU not connected** warning (routines may still run, but hardware calls will fail).

## Controller State Store (shared RAM)
Controller widgets should publish their state to an in-memory store (similar to global variables):
- `slider:<name> -> number`
- `joystick:<name>.x -> number`, `joystick:<name>.y -> number`
- `switch:<name> -> boolean`
- `indicator:<name> -> color`
- `display:<name> -> value`

Routines read those values via blocks:
- `get slider [name]`
- `get joystick [name] [x|y]`
- `get button [name]`

Important:
- Controller state is runtime-only RAM state.
- It is not treated as “routine changed/unsaved”.

## Routine execution in background (without Blockly UI)
Yes, routines can (and should) run without the Blockly visual workspace.

Recommended architecture:
- Blockly XML (`routines/<id>.xml`) is the editor source of truth for editing.
- Current implementation: the Controller tab loads the routine XML (RAM cache or disk), compiles it to async JS at trigger time, and executes it with the same `api` surface (JIMU commands, variables, controller inputs).

Why a “runner” is needed:
- Blockly UI is only for editing/highlighting.
- Runtime needs a scheduler/cancellation layer:
  - run multiple routines concurrently
  - route logs/trace
  - stop routines (Cancel token)
  - enforce JIMU BLE “single command at a time” constraint (queue)

Debugging note:
- Block highlighting requires the Blockly workspace.
- Background execution can run with `debug=false` (no highlight) and still log to trace.

## Bindings / triggers (MVP proposal)
Bindings live on widgets and define which routine to run.

General rules:
- Any event binding can be left **unconnected** (no routine selected).
- Events only need a selected routine to start; the routine may run indefinitely or may end after it completes.
- If a routine is already running, do **not** start it again (no re-entrancy).
- Add a global re-trigger cooldown (a constant, easy to change in code) to limit how fast a routine can be started again.

Suggested MVP bindings:
- Button:
  - optional keyboard shortcut
  - optional gamepad button shortcut
  - onPress → start selected routine
  - onRelease → start selected routine
  - onRelease → start selected Action
- Switch:
  - publish live value
  - onOn → start selected routine
  - onOff → start selected routine
- Slider:
  - publish live value
  - on value change → start selected routine
  - optional keyboard `Up/Down` bindings: changes value by `±1` (repeat while held)
  - optional gamepad button `Up/Down` bindings: changes value by `±1` (repeat while held)
- Joystick:
  - optional physical gamepad joystick mapping (note: multiple sticks/axes per gamepad)
  - publish live x/y; optional deadzone + rate limit
  - on value change → start selected routine
- Timer trigger:
  - every N ms → start selected routine
  - every N ms → start selected Action
- Keyboard/gamepad:
  - map a key/button/axis to a widget or directly to a routine trigger

## Suggested saved format (proposal)
Store controller design in `project.json` (schema TBD), e.g.:
- `controller: { mode, layout, widgets, bindings }`

Each widget:
- `id`, `type`, `name`
- layout: `x,y,w,h` (grid units)
- props: type-specific config (min/max, colors, labels)
- bindings: list of triggers → routine ids

## Actions in Controller (Milestone 5)
- Only **Button** and **Timer** widgets can trigger Actions.
- Button Actions are triggered on **release**.
- If the selected Action is already running, triggering it again is ignored.

## Open questions
- Grid resolution:
  - fixed (will check and test it)
- Naming rules for widgets (must be unique per project)?
  - yes
- Background routine concurrency limits (how many routines at once)?
  - no more than 1 instance of every configured routine
- Should controller widget states be persisted between runs or reset on connect?
  - reset on connect

## Slider widget (implementation notes)
- Modes:
  - `0` on left: value range `0..range`
  - `0` in center: value range `-range..0..+range` (0 is marked on the slider)
- `range` defaults to `100` (acts as max; min depends on mode).
- Auto center: when enabled, releasing the slider returns it to `0`.
- Keyboard/gamepad stepping repeats every ~250ms while held (constant in code).
