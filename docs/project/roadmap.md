# Roadmap

## Milestone 1 — “Connect & test”
Status: complete (2025-12-17)
- Device scan/connect UX in the app
- Status + battery + live logs in UI
- Basic manual controls: set servo position, rotate motor, read IR/ultrasonic

## Milestone 2 — “Project & model config”
Status: complete (2025-12-17)
- Project save/load/edit/save-as/delete + thumbnail import
- Project UI polish (no menu bar; compact project bar; battery indicator)
- Proper tab selector: Model | Actions | Routines | Controller | Logs
- Model Config saved calibration and live status colors (new/detected/missing)

## Milestone 3 — “Blockly MVP”
Status: complete (2025-12-19)
- Blockly workspace embedded in app (Routines tab)
- Block set MVP: control flow + math + variables + sensors + movement + show + debug
- Run/Stop controls and trace output
- Specification: `docs/project/routines.md`

## Milestone 4 — “Controller”
Status: complete (2025-12-22)
- Create visual controler designer (buttons, slider, joystick, indicator(led), display(number))
- routine backgroud execution (paralel)
- Widgets (button/slider/joystick) + triggers for routines
- Keyboard/gamepad events triggers for routines
- timers (repeated events like every 100ms) as triggers for routines
- Specification: `docs/project/controller.md`

## Milestone 5 — “Actions”
Status: complete (2025-12-22)
- Actions workspace in app
- Specification: `docs/project/actions.md`
- allow routines to call Actions,
- allow Action instead of routine in triggers (in controler)

## Milestone 6 — “TESTS”
[ ] test and check manualy whathewer I can
[ ] fix all found bugs
[ ] prepare "virtual JIMU" - version of JIMU brick, for demo an auto test
[ ] prepare automatic test using vitual JIMU.
[X] logs in project, rotate 10 last
[X] array variables
[ ] some spacial visualisations for array variables
[ ] make joystick faster, and not "hanging"
[X] move and eye are put in quee, no wait
[X] make quee heuristic
[ ] somtimes JIMU search need to be repeated many times

## Milestone 7 - Extras
[x] round or square joystick limiter
[x] routine code comments (to allow other understand routines), needed for templates
[ ] templates? - predefined routines for common problems:
  - joystick to: 2-wheller, 4-wheller, 6-wheeler, turning axis 4 wheeler, ...
- examples:
  - how to show build process of model? pictures?
  - joystick to walker, 2 legs x2, 2 legs x3 jonts, 4 legs, 
  - simple interacions
[ ] sounds, (would require recording, and connecting to speaker)

## Milestone 7 — “Distribution”
[X] Windows installer 
[x] show version number in title bar
[ ] icon for project
[ ] auto-update strategy
[ ] Crash reporting/log export -> to log?
[ ] fix: set JIMU_OPEN_DEVTOOLS=1

