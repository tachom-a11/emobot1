# Actions (pose sequences)

This document defines the pose-sequence concept and the editor behavior we want in the app.

## What is an Action?
An **Action** is a named timeline of **Frames** recorded from a real robot:
- Each Frame is a **Pose** (servo positions snapshot) plus a **duration** for reaching it.
- Many Frames chained together create an animation: walk, wave, dance, gestures, etc.

Actions are intentionally **non-code**: they're staged/recorded and edited visually.

## Storage & identifiers
Align Actions with the existing Routine model:
- An Action has a stable `id` (does not change on rename) and a user-facing `name` (must be unique within a project).
- `project.json` stores the Action list: `id`, `name`, `servoIds`, `totalDurationMs`, and timestamps.
- Each Action's frame data is stored in `actions/<actionId>.json` (similar to `routines/<routineId>.xml`).

Proposed `actions/<actionId>.json` shape:
```json
{
  "id": "uuid",
  "name": "Wave",
  "servoIds": [1, 2, 3],
  "frames": [
    { "durationMs": 400, "poseDeg": { "1": 0, "2": 10, "3": -15 } }
  ]
}
```

Notes:
- Store **UI degrees** (`-120..120`) in `poseDeg`. Playback clamps to calibration and applies `reverse`.
- `servoIds` is stored on the Action (in `project.json` and in the Action file) to support model checks (e.g. highlight missing servos in the Model snapshot).
- If a servo is missing at runtime, playback skips that servo and surfaces a warning (no hard fail).

## Action editor (UX requirements)

### 0) Action header (top bar)
The editor should always show a header area with:
- Current Action selector (switch between actions)
- Save
- Revert (discard unsaved changes)
- Close (return to Action list)
- Delete Action
- Test / play Action

Notes:
- Switching Action with unsaved changes must require confirmation (or offer Save / Discard / Cancel).
- Delete must require confirmation.
 - Use the always-visible **Emergency Stop** in the Project bar for an emergency stop.

### 1) Servo selection (which joints participate)
- User selects a subset of detected servos (positional servos, and "mixed mode" servos if the project supports it).
- Servos configured as **motor** mode are hidden from selection (Actions only support positional poses).
- When a selection is confirmed, the system prepares the robot for posing by hand:
  - Send `readServo` for all selected IDs to **release hold** (so the user can move joints manually).
  - If we need a "stiff/hold" mode later, expose it as an explicit toggle (do not assume `readServo` holds).

Selection rules:
- Servo selection is stored **per Action**.
- If servo selection changes after frames exist:
  - removing a servo removes it from **all frames**,
  - adding a servo adds it to **all frames** using the **current robot pose** at the moment of adding (read each added servo's position and fill that value into every frame).

### 2) Timeline / film-strip
- UI shows a horizontal film-strip of Frames.
- A new Action starts with **zero frames**.
- **Frame width is proportional to duration** (so timing is readable at a glance).

### 3) Add a Frame (capture current pose)
- User physically moves the robot into a desired pose and presses **Add**.
- System reads all selected servo positions:
  - Send `readServo` for each selected servo ID (or a safe batching strategy if supported).
  - Create a new Frame containing the captured Pose.
- Frame has an editable **duration**:
  - Default: 400ms
  - Allowed: 50-5000ms

### 4) Edit a Frame
- Selecting a Frame:
  - Sends `setServoPosition` for each selected servo to move the robot into that Pose (so the user sees/feels what they recorded).
- Fine tuning:
  - Servo sliders reflect the Pose stored in the selected Frame.
  - Moving a slider updates the Pose for that servo in the Frame and sends the servo command live (with safe pacing).
- **Record (overwrite)**:
  - User can move the robot into a new pose and press **Record** to overwrite the Pose of the currently selected Frame (duration is unchanged).

### 5) Frame operations
Required operations on the timeline:
- Duplicate frame
- Copy / paste frame
- Delete frame
- Insert new frame (by **Add** at the current cursor position)

## Safety & data-loss rules
- Emergency Stop is always visible in the Project bar and must immediately stop playback/commands.
- Any action that may lose work must require confirmation:
  - switching Action with unsaved changes
  - reverting without save
  - deleting an Action
- While an Action is playing, destructive edits should be disabled or require stopping first.

## Runtime behavior (how Actions execute)
When playing an Action:
- Frames are executed sequentially.
- For each Frame, issue a multi-servo set command (preferred) or a safely paced per-servo sequence, then wait for the Frame duration.
- Playback must obey BLE timing constraints (throttle writes; see `../protocol.md`).

Integration idea:
- Expose a runtime primitive like `playAction(nameOrId)` so Blockly Routines can trigger it.
- If the same Action is requested while it is already running, ignore the second request.
- Stopping Actions is best-effort: stop requests (from Emergency Stop or Blockly) stop before the next frame.

## Confirmed decisions
1) **Project format**: Actions live as separate files: `actions/<id>.json` (like routines).
2) **Action list schema**: `project.json` stores `id`, `name`, `servoIds` (plus timestamps).
3) **Servo selection changes**:
   - remove servo => remove from all frames,
   - add servo => add to all frames with the servo's current pose value.
4) **Playback semantics**: `durationMs` is the **move time** to reach the pose; holding a pose is expressed by adding a subsequent frame with the same pose and a hold duration.
5) **Motor-mode servos**: hidden from selection (cannot be used in Actions).
