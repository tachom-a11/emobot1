# Project controls

This document describes the project bar and safety controls that are shared across tabs.

## Required controls (target UX)
- **No menu bar**: project actions are accessible from the project bar (no File menu).
- **Thumbnail**: shown on the left; edited via the **Edit project** dialog. Imported images are resized to 64x64 and stored as `assets/thumbnail.png`.
- **Project name**: displayed as text; editable only via **Edit project**.
- **Project description**: displayed as text; editable only via **Edit project**.
- **Battery indicator**: shown under Emergency Stop; updates about every 30s when connected.
  - Assumption for percent: `6.5V = 0%`, `8.4V = 100%` (linear mapping).
  - Low battery: `<10%` shown in red; disconnected state shown in gray.
- **Dirty state**: show unsaved changes and confirm on actions that would lose changes (close project, open another project).

### When no project is open
- **Project picker**: list saved projects (thumbnail, name, short description) with an Open button.
- **Create project**: opens a dialog (name + optional description), then creates on disk.

### When a project is open
- **Close project**: if connected, emergency stop + turn off LEDs + disconnect; if dirty, ask whether to save.
- **Edit project**: opens a dialog to change name/description and thumbnail; Delete is only available inside this dialog.
- **Save**: write the current project to disk (no prompts if already has a path).
- **Save As**: clones the project into a new folder (including `assets/thumbnail.png`).
- **Revert**: reload the project from disk; any open calibration/config panels (e.g. servo/motor) must immediately reflect the reloaded values (or be closed if the module is no longer detected).

## Project storage rules
- Projects stored in `./jimu_saves/` (one folder per project id)
- Store the brick id/name used for the project; if the same brick is found during scan, preselect it for connect.
- Save model snapshot + calibration:
  - Module list snapshot with IDs saved to project file
  - Servo calibration (mode [servo | motor | mixed], range limits, speed limit, reverse)
  - Motor calibration (speed limit, reverse)

## Emergency Stop
Always-visible red button on the right side of the project bar.

Behavior:
- Immediately stop any motion/playback and cancel running routines.
- Make the robot safe:
  - Release servos (in this project, `readServo` / `readServoPosition(0)` is used as a “release hold” operation).
  - Stop all motors (send speed = 0 for each detected motor).
  - Stop all continuous servo rotations (send rotate velocity = 0 for detected servos that are in motor/mixed mode, or simply for all servos if mode is unknown).
  - Turn off LEDs (eyes + ultrasonic LEDs).
- Must work even if a tab is mid-operation; no confirmation dialogs.

Notes:
- Emergency Stop should not disconnect by default (disconnect is a separate control).
- Log the emergency stop action and any errors.
