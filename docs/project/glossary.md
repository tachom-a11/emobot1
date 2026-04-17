# Glossary

- **Brick / Master Brick**: the main JIMU controller that exposes BLE and connects to modules.
- **Module**: a peripheral connected to the brick (servo, motor, IR, ultrasonic, eye LEDs, speaker).
- **ID**: per-module identifier (often 1..8 or 1..32) used in commands.

- **Action**: a named **pose sequence** (timeline of frames) recorded from real servo positions and played back as an animation (walk, wave, dance). See `actions.md`.
- **Frame**: one step in an Action (servo positions snapshot + duration to reach that pose).
- **Pose**: the set of servo target positions captured for a Frame.

- **Routine**: a named Blockly “procedure/function” that runs code (control flow, sensors, device commands) and may call Actions.
- **Trigger**: event that starts a Routine (Start, keyboard, gamepad, widget change).
- **Timer**: scheduled Trigger that fires every N ms/s.
