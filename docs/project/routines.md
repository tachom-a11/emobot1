# Routines (Blockly MVP)

This document defines the Milestone 3 behavior for the **Routines** tab, the Blockly editor, and the current block set.

## Concepts
- A **Routine** is a named program created with blocks (Blockly).
- A project can contain **multiple routines**.
- A routine has:
  - `id` (stable identifier; does not change on rename)
  - `name` (user-facing; must be unique within a project)
  - `workspace` (Blockly serialization, stored as XML)

## Storage (project format)
- Store each routine workspace in `routines/<routineId>.xml`.
- `project.json` stores a list of routines (id + name + timestamps).

Notes:
- Do not use the routine name as the filename (rename should not rename files).
- Keep routine IDs stable so other features (controller bindings, triggers, etc.) can reference routines later.

## Runtime load/save model (RAM vs disk)
When a project is open, the app keeps a **RAM project state**. Disk (`jimu_saves/<projectId>/...`) is only persistence.

Important implementation note:
- All project-state data (routines list, routine XML cache, variables, controller layout, and future features like **Actions**) must be owned by the **App-level RAM state** (top-level store), not tab-local component state. Tab switches, reconnect flows, or UI remounts must never drop or reload RAM-only edits from disk unless the user explicitly opens a project or saves a project.

Required behavior:
- **Project Open** loads `project.json` into RAM (including calibration, routines list, and `variables`).
- The Routines tab preloads each routine XML into a RAM cache (best-effort).
- **Open routine** initializes Blockly from the **RAM routine definition**.
- **Save (in routine editor)** updates the routine definition in **RAM only** (no disk write).
- If you leave the editor without saving (Back → Discard), **RAM is unchanged**.
- **Project → Save** persists the entire RAM project state to disk:
  - writes `project.json` (including `variables` and `routines`)
  - writes routine XML files for routines stored in the RAM cache
  - removes routine XML files that are no longer referenced by `project.json.routines`

## Routines tab (panel UX)
Required UI:
- Routine list: one row per routine, showing `name` and optional summary (updated time).
- **Create routine**: create an empty routine and open it in the editor.
- **Open** routine: opens the Blockly editor for the selected routine.
- **Rename** routine: edit routine name (validation: non-empty, unique).
- **Delete** routine: must require confirmation.
- Unsaved changes prompt: when leaving the editor with changes, prompt Save / Discard / Cancel.

## Blockly editor (routine editor UX)
Opening a routine switches the Routines tab into an editor view.

### Top bar
Required controls:
- **Back** (return to routine list)
- **Run** (test routine)
- **Stop**
- **Delay** (debug stepping delay): 0ms / 100ms / 500ms / 1000ms
- **Save**
- **Rename**
- **Delete** (confirmation required)
- **Variables** (open variables manager dialog)
- Status area:
  - Connection state: Connected / Disconnected
  - Execution: Idle / Running / Stopped / Error
  - Last error message (if any)

Stop behavior:
- Pressing **Stop** cancels execution and runs a best-effort safety stop:
  - stop motors/servos (release holds)
  - turn off Eye LEDs and Ultrasonic LEDs (for modules listed in the project snapshot)
- If the brick is not connected while stopping, cleanup commands may fail with “Not connected” (expected).

Debug behavior:
- While running, the currently executing block is highlighted in the workspace.
- The **Delay** setting adds an extra delay after each block (except `wait` / `wait until`).

### Left toolbox (block library)
MVP categories (as implemented):
- **Control**
- **Math**
- **Variables**
- **Sensors**
- **Movement**
- **Show**
- **Debug**

Notes:
- Text category is intentionally not included.
- Module selectors (IR/Ultrasonic/Eyes/Servos/Motors) are populated from the **project snapshot** (`project.json`), not live detection.

## Block catalog (as implemented)

## Device command semantics (queue vs wait)
The runtime uses an SDK-level command queue to serialize BLE access. Blocks fall into two categories:
- **Enqueue-only (fire-and-forget):** returns immediately after enqueue. The SDK may coalesce queued actuator commands (latest wins per target).
- **Await response:** waits for a specific reply (or timeout). Used for sensor reads and status/battery operations.

This matters for performance: in Controller/joystick scenarios, you generally want enqueue-only outputs and explicit `wait` blocks only when needed for timing.

### Control
- `if / if-else` (`controls_if`): branch based on a boolean condition.
- `repeat N` (`controls_repeat_ext`): run nested statements N times.
- `while / until` (`controls_whileUntil`): loop while/until a boolean condition is met.
- `break / continue` (`controls_flow_statements`): break out of or continue the innermost loop.
- `routine [name]` (`jimu_routine`): run another routine as a subroutine/procedure.
- `wait [ms]` (`jimu_wait`): delay for a duration; cancellable via Stop.
- `wait until <condition>` (`jimu_wait_until`): polls until condition becomes true (50ms polling); cancellable via Stop.
- `stop action [name]` (`jimu_stop_action`): requests stopping a running Action (best effort; stops before the next frame).
- `stop all actions` (`jimu_stop_all_actions`): requests stopping all running Actions (best effort; stops before the next frame).

Subroutines (safety rules):
- A routine cannot be deleted if it is referenced by another routine via `routine [name]`.
- Recursive calls are blocked:
  - while selecting a routine, you cannot select yourself
  - you also cannot select any routine that (directly or indirectly) calls the current routine
  - runtime also rejects recursion as a safety net

### Math
- `number` (`math_number`): numeric constant.
- `true / false` (`logic_boolean`): boolean constant.
- `arithmetic` (`math_arithmetic`): +, -, ×, ÷, power.
- `math function` (`math_single`): unary functions (negate, abs, sqrt, ln, log10, exp, etc.).
- `trigonometry` (`math_trig`): sin/cos/tan + inverses.
- `rounding` (`math_round`): round / round up / round down.
- `random integer from [a] to [b]` (`math_random_int`): inclusive random int.
- `constrain [value] low [low] high [high]` (`math_constrain`): clamp a number into range.
- `compare` (`logic_compare`): compare two values; returns boolean (<, ≤, =, ≥, ≠, >).
- `and / or` (`logic_operation`): boolean algebra.
- `not` (`logic_negate`): boolean negation.

### Variables
- Create variables from the **Variables** dialog (top bar button).
- `set [variable] to [value]`: assign variable.
- `get [variable]`: read variable value.
- `change [variable] by [value]`: add delta to the variable.

Global variables (important):
- Variables are **global per project** and shared between routines in real time (used for inter-routine communication).
- Variables are keyed by **variable name** (not Blockly internal IDs), so using the same name in two routines refers to the same global value.
- Initial values are loaded from `project.json.variables` on Project Open; runtime values live in RAM; Project Save persists the current RAM values back to `project.json.variables`.

Variables dialog rules:
- Shows current value as `= <value>` on the right side.
- Rename is disabled (to keep cross-routine references stable).
- Delete is blocked if the variable name is used by another routine.

### Sensors
- `read IR [id]` (`jimu_read_ir`) returns a number.
- `read Ultrasonic [id] (cm)` (`jimu_read_us`) returns a number.
  - Convention: if the device raw value is `0` (out of range), this returns `301.0`.
- `read servo [id] (deg)` (`jimu_read_servo`) returns a number.
- `battery level (%)` (`jimu_battery_percent`) returns a number.
  - Returns `0..100` using the same voltage calibration as the UI battery icon.
- `battery charging?` (`jimu_battery_charging`) returns a boolean.
- `get slider [name]` (`jimu_get_slider`) returns a number (placeholder until Controller widgets exist).
- `get joystick [name] [x|y]` (`jimu_get_joystick`) returns a number (placeholder until Controller widgets exist).
- `get button [name]` (`jimu_get_button`) returns a boolean (Controller Button widget state).

Notes:
- These blocks **await responses** from the brick (and can block on timeouts), so they are slower than enqueue-only actuator blocks.

### Movement
- `set servo position` (`jimu_set_servo_timed`)
  - Mutator block: add/remove servo rows; each row selects a servo ID and provides its target degrees.
  - Sends one multi-servo position command (duration is encoded as speed); **does not wait**. Add an explicit `wait` block if you need timing.
- `rotate servo` (`jimu_rotate_servo`)
  - Mutator block: add/remove servo ID rows (IDs must be distinct).
  - Speed is shared, clamped to configured limits; negative speed reverses direction internally.
- `stop servo` (`jimu_stop_servo`)
  - Mutator block: add/remove servo ID rows (IDs must be distinct).
- `rotate motor, duration` (`jimu_rotate_motor`)
  - Mutator block: add/remove motor rows; each motor has its own speed; duration is shared.
- `stop motor` (`jimu_stop_motor`)
  - Mutator block: add/remove motor ID rows (IDs must be distinct).
- `action [name]` (`jimu_select_action`): play an Action (pose sequence) selected from the project Actions list (ignored if that Action is already running).
- `emergency stop` (`jimu_emergency_stop`): immediate stop + cancels the routine run.

### Show
- Eye LED blocks:
  - `eye LED eyes [x] color [color]` (`jimu_eye_color`)
  - `eye LED eyes [x] color [color] duration [ms]` (`jimu_eye_color_duration`)
  - `eye LED eyes [x] color [color] scene [1..15] repeat [n] wait [bool]` (`jimu_eye_scene`)
  - `eye LED eyes [x] custom <8 segment colors>` (`jimu_eye_custom`)
  - `eye LED eyes [x] custom <8 segment colors> duration [ms]` (`jimu_eye_custom_duration`)
  - `eye LED eyes [x] off` (`jimu_eye_off`)
- Ultrasonic LED blocks:
  - `ultrasonic LED [id] color [color]` (`jimu_us_led_color`)
  - `ultrasonic LED [id] off` (`jimu_us_led_off`)
- Controller placeholders (until Controller widgets exist):
  - `indicator [name] color [color]` (`jimu_indicator_color`)
  - `display [name] show [value]` (`jimu_display_show`)

Notes:
- Eye LED and Ultrasonic LED blocks enqueue their commands (do not wait for a device response).

### Debug
- `Print [value]` (`jimu_print`)
  - Shows the current value on the block itself while running.
  - This is a runtime-only UI update and does not mark the routine as “unsaved”.
- `log [value]` (`jimu_log`)
  - Writes to the routine Trace panel and also to the global Logs tab.
  - Accepts any value type.
