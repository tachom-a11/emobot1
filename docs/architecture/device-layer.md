# Device layer (SDK + BLE)

## Goal
Provide a single, tested API for the app/runtime to control a real JIMU brick, hiding:
- BLE discovery/connection quirks
- boot sequence + keep-alives
- command pacing/retries
- parsing frames/acks/errors

## Code locations
- High-level SDK: `jimu/jimu.js`
- BLE client + frame parsing: `jimu/jimu_ble.js`
- Reverse-engineering probes: `probe/`

## What the SDK does today
- Connect + boot: `0x36` (info) ƒÅ' `0x01` (probe) ƒÅ' `0x08` (status) ƒÅ' `0x71` (enable) ƒÅ' `0x27` (battery)
- Keep-alive: periodic `0x03` ping + optional battery polling
- Parse status: firmware string + bitmasks for detected modules (servos, IR, eyes, ultrasonic, speaker, motors)
- Common commands:
  - Servos: set position (`0x09`), read (`0x0B`), continuous rotate (`0x07`)
  - Motors: rotate (`0x90`)
  - Sensors: IR/ultrasonic read (`0x7E`)
  - Eyes: solid color + segments (`0x79`)
  - IDs: change peripheral (`0x74`) and servo (`0x0C`) IDs

## Constraints we must respect
- **Write spacing**: bursts below ~25ms can drop responses; throttle and retry (see `../protocol.md` timing notes).
- **No overlap (single in-flight command)**: do not send a new command until the previous command's response has been received (or timed out). Interleaving commands (even keep-alive pings) can cause missing sensor/servo responses.
- **Notification parsing**: device can concatenate multiple frames into one notification; parser must split `FB ... ED`.
- **Backpressure**: always subscribe to notifications and drain them; otherwise writes can ƒ?ostallƒ??.

## Command queue (current implementation)
The SDK serializes all device writes through a single internal command queue:
- Only one BLE command is sent at a time (enforces the “no overlap” rule).
- Writes are paced using a minimum spacing (default ~25ms).
- Some commands are **enqueue-only** (fire-and-forget): they enqueue and return immediately (used for high-rate controller/routine outputs).
- Some commands are **awaited**: they enqueue and then wait for a matching response/ack (used for reads and status/battery calls).

### Queue heuristics (coalescing)
To avoid backlog during high-rate inputs (joystick/slider), the SDK applies two heuristics to actuator commands:
1. **Exact duplicate suppression**: if the exact same command payload is already queued/in-flight, the new enqueue is ignored.
2. **Latest-wins per target**: if a new command targets the same servo/motor/eye/ultrasonic LED as an older queued command, the older one is dropped before sending.

Notes:
- Coalescing is applied only to actuator outputs (servos/motors/LEDs), not to reads (IR/US/servo read/status/battery).
- Emergency Stop flushes the pending queue before sending stop commands (in-flight commands cannot be interrupted).

### Queue telemetry
The SDK emits `sendQueue` telemetry events with:
- `pending`: queued commands count (pending, not including current in-flight)
- `inFlight`: whether a command is currently being sent/awaited
- `currentWaitMs`: enqueue→send delay for the current command

## Design contract (for UI/runtime)
- All public SDK calls are async and return decoded results or a typed error.
- The SDK owns command serialization and pacing.
- The SDK emits events (status/battery/frame/errors) for UI telemetry without coupling UI to protocol details.
- For debugging, the app can log both RX and TX payloads as hex (`<= cmd=...` for received frames, `=> cmd=...` for transmitted frames) when verbose logging is enabled.
