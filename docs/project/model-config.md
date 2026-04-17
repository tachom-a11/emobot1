# Model Config tab

This tab is the **live hardware** surface: connect to a real JIMU brick, view detected modules, and edit calibration/settings stored in the current project.

## Current behavior (as implemented)

### Connection section
- **Scan bricks** runs a ~4s BLE scan and fills the brick selector. If the project has a saved `hardware.connectedBrick.id` and that brick is found, it is auto-selected.
- **Connect** connects to the selected brick and runs boot (status → enable → battery), then updates:
  - UI connection `status`
  - firmware string (and stores it in the project as `hardware.firmware`)
  - battery voltage/charging flag (UI only; not stored to disk)
  - detected modules (UI only)
- **Refresh status** re-reads status (module discovery) and updates the UI only.
- **Change ID** opens a modal that can change module IDs (requires connection), then runs **Refresh status** to rescan detected modules:
  - Select module type: Servo / Motor / IR / Ultrasonic / Eye / Speaker
  - `From ID`: populated from currently detected IDs for the selected type and always includes `0` ("fix" mode for bad/hidden IDs)
  - `To ID`: validated as `1..32` for servos, `1..8` for all other types

Events pushed from the device:
- `jimu:status` updates detected modules in UI.
- `jimu:battery` updates battery info (polled about every 30s by the SDK).
- `jimu:disconnected` resets connection state and closes feature panels.

### Live module overview (status colors)
The overview shows the union of:
- the saved project snapshot (`project.hardware.modules`)
- the currently detected modules (live status)

Each module ID is colored:
- `detected` (green): saved in snapshot and detected now
- `new` (blue): detected now but not present in the saved snapshot
- `missing` (gray): present in the saved snapshot but not detected now

Notes:
- Missing modules are shown as disabled (not clickable).
- Red/error state is reserved for later when Routines/Actions can reference modules.

### Saving the module snapshot
The project snapshot is updated **only on Project Save**:
- current live modules are copied into `project.hardware.modules`
- `missing` modules are pruned from the saved snapshot on Save
- `new` modules are added to the saved snapshot on Save

### Servo details panel
Clicking a detected servo opens a panel and requests current position.

Units:
- UI and SDK use degrees `-120..120` (`0` center).

Stored per-servo settings (in `project.calibration.servoConfig[id]`):
- `mode`: `servo` | `motor` | `mixed`
- `min`, `max` (degrees)
- `maxSpeed` (1..1000)
- `reverse` (boolean)

Positional (mode `servo` / `mixed`):
- Touch-bar style slider `-120..120` with 3 markers: `min`, `max`, and `test` (test is clamped to `[min,max]`)
- **Test position** sends the servo command
- **Stop / release** runs `readServo` to release hold
- **Save settings** writes to the project (requires Project Save to persist to disk)

Rotation (mode `motor` / `mixed`):
- Direction (`cw` / `ccw`) for test rotation
- Speed slider (0..maxSpeed)
- **Test rotation** / **Stop**
- **Save settings** stores `mode/maxSpeed/reverse` in the project

### Motor details panel
Clicking a detected motor opens a motor panel.

Stored per-motor settings (in `project.calibration.motorConfig[id]`):
- `maxSpeed` (1..150)
- `reverse` (boolean)

Motor rotation:
- Direction (`cw` / `ccw`) for test rotation
- Speed slider (0..maxSpeed) and duration (0..6000ms)
- **Test rotation** and **Stop** (speed=0)
- **Save settings** writes to the project (requires Project Save to persist to disk)

### IR / Ultrasonic panels
Clicking any IR or Ultrasonic module opens its dedicated panel:
- Panels poll at ~4Hz using a single in-flight request (no overlapping BLE commands).
- Values are shown per detected sensor ID.

Ultrasonic units:
- Displayed in cm; raw `0` is treated as out-of-range and displayed as `301.0 cm`.

Ultrasonic LED:
- Solid RGB test + **Off** (no blinking)
- Uses protocol `0x79 0x06 ...` with fixed `level=1` internally.

### Eye panel
Clicking an Eye opens a panel for a single eye ID:
- Color picker and quick swatches
- Solid RGB test and Off
- Simple animations (blink / pulse / rainbow) with Start/Stop

## Revert behavior
Project **Revert** reloads project data from disk and must update any open config panels:
- servo/motor panels immediately reflect reloaded calibration values, or close if that module is no longer detected
