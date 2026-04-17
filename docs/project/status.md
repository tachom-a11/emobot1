# Project status

## What works today
- Electron dev shell runs (`npm run dev`)
- BLE scan/connect + boot sequence via `jimu/` (with command serialization)
- Status parsing, battery polling (~30s), live logs/frames
- Project persistence on disk in `./jimu_saves/<projectId>/project.json`
  - Create/open/edit/save/save-as (clone)/revert/delete + thumbnail import to `assets/thumbnail.png`
- Model Config UI:
  - Live module discovery + color states (new/detected/missing)
  - Servo calibration + motor calibration saved to project
  - IR/Ultrasonic panels + LED controls
  - Eye panel with color picker + simple animations
- Routines tab (Blockly MVP):
  - Routine list: create/open/rename/delete
  - Blockly editor with toolbox, variables dialog, trace output
  - Run/Stop (cancellable) using IPC-only device API
  - Routines persisted as `routines/<id>.xml`
- Action editor (pose-sequence timeline) and playback
- Controller widgets and bindings
  - create controller, link routines and actions
  - bind keys
  - bind gamepad

## What's planned next
- tests, it this realy works
- Packaging/installer for Windows

## Nice to have
- touch sensor, extra sensor integration - I don't have it
- color sensor, extra sensor integration - I don't have it
- brick for AI verion, check if it works with this code - I don't have it

## Risks / unknowns
- BLE reliability across adapters/drivers (timing/backpressure matters)
- Completing protocol coverage for all modules and commands
- Maintaining safety limits to protect hardware during experiments
