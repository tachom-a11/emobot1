# UBTECH JIMU Bluetooth API (research draft)

> Note: UBTECH has not published an official public spec for JIMU BLE. The following is a working hypothesis to guide implementation and reverse-engineering. All packet formats and UUIDs must be verified against real hardware.
> inspiration: https://github.com/msantang78/node-jimu/blob/master/PROTOCOL.md

## Quick status (what's known vs missing)
- Framing/acks: `FB BF <len> ... checksum ED`, ack pattern `fb bf 06 <cmd> 00 <chk> ed`; error pattern `fb bf 06 <cmd> 01 <id> 01` with follow-up 0x05 error report.
- Working commands: init (0x36, 0x01, 0x08), enable (0x71), battery (0x27), ping (0x03), servo set/read (0x07/0x09/0x0B), motor (0x90 single/dual), sensor read (0x7E), ID changes (0x74/0x0C), eye LEDs (0x78/0x79), error query (0x05).
- Timing: reliable writes at ~25-50 ms spacing; 10 ms/5 ms produced drops. Notifications typically ~60 ms apart with jitter to ~1.3 s.
- **Critical constraint (no overlap):** only one command may be in flight at a time. After sending a command that expects a response (e.g. `0x08`, `0x27`, `0x0B`, `0x7E`), do not send any other command until the corresponding response arrives (or a timeout is hit). Overlapping commands can cause missing responses and repeated timeouts.

Implementation note (this repo):
- The app enforces the “no overlap” rule with an SDK-level command queue (`jimu/jimu.js`) that serializes all device writes.
- High-rate actuator outputs (servos/motors/LEDs) are typically sent as **enqueue-only** commands (fire-and-forget), with coalescing to avoid backlog (latest wins per target).
- BLE layout: custom service starting with `49535343`; characteristic order not locked (notify/write selection heuristics in code). Needs on-device UUID confirmation.
- Missing/needs check: service/characteristic UUIDs and order; meaning of 0x72, 0x2b, 0x2c, 0x3b, 0x91, 0x92; speaker control path; sensor value scales/units; eye segment masks; MTU limits; multi-frame notification splitting rules.
- Redundant/raw sections below are kept for now-tagged "(review/remove?)" where they look like unprocessed captures or duplicated notes.

## Plan to confirm protocol
- Use a BLE sniffer (nRF Sniffer or similar) or the nRF Connect app to inspect services/characteristics after pairing with the official JIMU app. => not working, and can't work. BT transmision is ENCRYPTED!
- Log traffic when orginal app is connecting and preparing JIMU brick, make every posible action in device to generate most commands to detect them all. 
- Generate abobe command from software to check what is happening. (Will sniff serial bus)
- Validate MTU, write-without-response vs write-with-response, and notification characteristics.
- OLD android device needed! galaxy S4, Android 5 - works, newer - not! (HCI log not generated). 
  - Enable programer mode
  - enable bluetooth HCI log
  - unpair bluetooth
  - reboot phone!
  - generate bluetooth trafic
  - using `adb pull /sdcard/Android/data/btsnoop_hci.log .` , get log
  - open log with Wireshark (field btspp.data - contains our protocol)
  - create disected for this data (to analise)
- create serial sniffer to check what is sending to devices by central unit with simulated BT commands.

## Findings from `msantang78/node-jimu` and real sniffing (raw notes; needs cleanup/verification)
- Packet framing:
  - Header bytes: `0xFB, 0xBF`.
  - Length byte: `payload.length + 4` (length + payload + checksum in builder logic).
  - Payload data: `[command, ...params]`.
  - Checksum byte: sum of bytes starting at the length byte (length + payload).
  - Terminator: `0xED`.
  - Example full packet (read servo position): `[0xFB, 0xBF, 0x07, 0x0B, 0x00, 0x00, 0x0B, 0xED]`.
  - Generic ack pattern observed during scans: `fb bf 06 <cmd> 00 <checksum> ed` (echoes the command byte with a zero status and checksum). - means OK.
  - If expected response should be `[<cmd> 00]`, but returs `[<cmd>, 0x01, <id>, 0x01]` -> means ERROR on device `<id>`.
    This response if for motor or servo actions.
    There should be cmd=`0x05` extra response emited with error details.
  - Sometimes single Notification can send multipre responses gulued together like: <fb bf 06 08 ee fc ed fb bf 06 08 ee fc ed>, this should be split to multiple responses, <fb ... ed> , <fb ... ed>
- BLE layout (implicit):
  - Device discovered by advertised local name match.
  - After `discoverAllServicesAndCharacteristics`, writes go to `characteristics[0]`, notifications read from `characteristics[1]` (UUIDs not specified).
  - Observed: the device emits short ack/position notifications for servo commands (`0x09`/`0x0B`). If notify characteristics are not subscribed and drained, subsequent writes may be processed only once (ATT queue stalls). Subscribing and parsing notifications restores repeated set-position writes.
- Implemented commands (to validate):

Boot sequence (done by original app):
- Brick info (`0x36`):
    - `[0x36, 0x00]` querybrick info
    - response hex (Jimu2): `[36 4a 69 6d 75 32]`    (Jimu2)
    - response hex (Jimu1): `[0x36 0x00 0x53 0x31 0x4a 0x49 0x4d 0x55]` // old brick

- Probe brick devices (`0x01`):
    - `[0x01, 0x00]` query brick info, brick start probing all devices
    - response hex:   `[01 00 4a 49 4d 55 32 50]`   (\00JIMU2 P)
    - what brick probes - scan on serial interface: (new brick JIMU2)
      * SERVOS 1-32
      * IR 1-8
      * something 0x07 1-8 (serial frame: Raw Frame: f77f 06 07 01 0eed)
      * EYE 1-8
      * Ultrasonic 1-8
      * something 0x07 1-8, frame: f66f (Raw serial Frame: f66f 06 07 01 0eed)
      * MOTORS 0x07 1-8, frame e99e,  (Raw serial Frame: e99e 06 07 01 0eed) - MOTORS
      * something 0x08 1-8, frame e88e (Raw serial Frame: e88e 06 07 01 0eed)
      * something 0x05 1-8, (raw serial frame: fb03 06 05 01 0009000562)
      * motor 1-8
    - response is imidiate, but you should wait ~3 sec for all check above to complete


- Brick status (`0x08`): (old brick - probe here)
    - `[0x08, 0x00]` query connected devices - return something only after probe (0x01) on Jimu2 brick!
    Response:
    - len can warry, show all detected devices, version of brick, ect. 
    - WARNING!, CHECK, sometimes, response (len < position for mask) -> means this device not detected
    - first response char 0x08, - position 0, [b0]
    - text: brick version bytes 1-11 (can be padded with 0x00)
    - detected servos, bitmask bytes 12-15, [b12,b13,b14,b15] = bit mask "1" if servo is present bits:[id32, ... , id1]
    - detected IR range finders, byte 29, [b29], bit mask bits [id8 .. id1] 1 for every detected IR
    - detecled EYEs, byte 50, [b50], bit mask bits [id8 .. id1] 1 for every detected eye
    - detected Ultrasonic Range, byte 64, [b64], bit mask bits [id8 .. id1] 1 for every detected ultrasonic
    - detected speakers, byte 78, [b78],  bit mask bits [id8 .. id1] 1 for every detected speaker
    - detected motors, byte 120, [b120], bit mask bits [id8 .. id1] 1 for every detected motor
    
    - example response hex: `[08 4a 69 6d 75 5f 70 31 2e 37 39 4f 00 00 04 00 00 00 00 00 41 16 51 01 00 00 00 00 04 01 00 0f 10 0c 14 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 30 02 a1 10 30 10 00 00 00 00 000 00 00 01 00 0b 12 05 0a 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00]` (Jimu_p 1.790 + lot extras?)
    - example, old system hex: `[08 4a 69 6d 75 5f 62 30 2e 32 36 51 00 01 00 00 00 00 00 00 41 16 51 01 00 00 00 00 04 01 00 0f 10 0c 14 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 03 00 2a 11 03 01 00 00 00 00 00 00 00 00 01 00 0b 12 05 0a 00 00 00 00 00 00 00 00 01 00 01 11 03 14 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 01 00 01 00 01 06 00 00 00 00 00 00 00 00]` (Jimu_b0.26Q)

    - probe on serial (old brick probe here)
      * servo 1-32
      * eye 1-8
      * ir 1-8
      * something 0x07 1-8 (frame: e88e)
      * MOTORS 0x07 1-8 (frame: e99e)
      * something 0x07 1-8 (frame: f77f)
      * ultrasinic 1-8
      * something 0x05 1-5

### Unknown/unclear commands (needs verification)
-  ERROR (`0x05`):
    - `[0x05, 0x00]` query returns `[05 00]` when no faults. 
    - `[0x05, 0x01]` meaning unknown.
    - Error responses (e.g., motor error) appear as `[0x05, 0x0400000000000000000000000000000000000000000000000100000000]` with bitmasks; need mapping for error types/bits. This example means motor ID1 error.

-  ??? (`0x72`):
    - Seen during init. `[0x72 0x08, 0x01]` query? Response `[72 08 00 01 88 1b 99 14 e3 c2 4a 69 6d 75 73 70 6b 5f 45 33 43 32]`. Omitting had no visible effect. Serial frames shown below (review/remove if redundant).
-  ENABLE (`0x71`) - during init many times, exec with diffrent paramaters. 
    Prepare sensors, speakers and eyes for use.
    Need to be executed for every detected device group from IR, EYE, Ultrasonic. Speaker
      - Device init, `[0x71, <device type>, <bit ID: binary mask>, 0x00]`
        <device type>:
          0x01 = IR range sensor
          0x02 - ??? to test?
          0x03 - ??? to test?
          0x04 = LED eye
          0x05 - ??? to test?          
          0x06 = Ultrasonic range finder
          0x07 - ??? to test?          
          0x08 - Speaker (to check)          
        <bit ID> is: mask, a bit for every device present. Low bit = ID1 bits: [ID8,...ID1]]
    Sniff , examples:
    - Eye enable send:  `[0x71, 0x04, 0x03, 0x00]` // eye config ID1 and ID2
      - response   `[0x71, 0x04, 0x03, 0x00]`
    - IR enable send: `[0x71, 0x01, 0x01, 0x00]` // IR config ID1
      - response   `[0x71, 0x01, 0x01, 0x00]`
    - Ultrasonic enalbe send:  `[0x71, 0x06, 0x01, 0x00]` ?? // when ultrasonic, ultrasonic config, ID1
      - response   `[0x71, 0x06, 0x01, 0x00]`
    - speaker enable ID1 send:  `[0x71, 0x08, 0x01, 0x00]`
          response   `[0x71, 0x08, 0x01, 0x00]`


-  BATTERY (`0x27`) query for charging and voltage, don know how to calculate voltage / level -
    - `[0x27, 0x00]` query, can be voltage?
    - response hex: `[27 <charging 0|1> 00 volt_high volt_low]`
      * response is emited after connecting/disconnecting from chargoing too (without request!)
      * voltage = (volt_high * 256 + volt_low) / 2500   (need to be calibrated)

    - samples    hex: `[27 00 00 50 4c]` <- difrent aswers from dif brick/config?
                    `[27 00 00 50 4b]`
                    `[27 00 00 4f 41]` <- dirdent setup?>
                    `[0x27 0x01 0x00 0x53 0x5e]` -  charging


-  query??? (`0x2c`) - during init: brick?
    - `[0x2c, 0x00]` query / set ??
    - response hex: `[2c 00 33 31 31 20 05 51 4d 57 3f 00 2d 00]`  
                    `[2c 00 36 33 37 20 13 51 4d 59 18 00 28 00]` <= difrent aswers from dif brick/config?
      Data: 003331312005514d573f002d00
      Data: 003633372013514d5918002800
      Data: 003331312005514d573f002d00  // 1 ultrasonic
      Data: 003331312005514d573f002d00  // 1 eye
    - no serial data.
    - no idea what it is doing
    - need to investigate


-  query??? (`0x2b`) - during init:
    - `[0x2b, 0x07]` query ??
    - response hex: `[2b 02]`   // when 1 ultrasonic
                    `[2b 00 30 32 39 33 31 37 30 38 31 31 30 30 32 39 35]` <= difrent aswers from dif brick/config?
                    `[2b 07]`   // when eye
    - no serial data. when response short `[2b 02]`
    - no idea what it is doing
    - need to investigate

COMMANDS:
------
-  PING (`0x03`) - every few second, looks like ping.:
    - `[0x03, 0x00]` ping?
    - response hex: `[09 00]`  
    - to make sure that brick/brick still connected.
    - orginal app emit this every few seconds
    - no serial data.

-  CLEAR_ERROR (`0x3c`) - not sure if correct
    - send: `[0x03, 0x00]` 
    - was send after error twice,
    - no replay

- Servo continous rotation (`0x07`):
    - Single servo: `[0x07, 0x01, servoId, direction(1|2), velocity_hi, velocity_lo]` (velocity is 16-bit; effective range observed up to ~1000).
    - Dual/axle (observed): 
          `[0x07, 0x02, servoId1, servoId2, direction((0?)|1|2), velocity_hi, velocity_lo]`.
          0x07, 02 01 02 00 00 00  <- stop?
          0x07, 02 01 02 02 01 07
          0x07, 02 01 02 01 01 cc
      - to drive two servos together - that same direction and speed. 
      - can be usefull for 4 whell (pairs run that same)
    - Quad/pairs (observed): 
        `[0x07, 0x04, servoId1, servoId2, servoId3, servoId4, direction(0?|1|2), velocity_hi, velocity_lo]`
         0x07, 04 01 02 03 04 - 01 01 cc
         0x07, 04 01 02 03 04 - 02 01 cc
         0x07, 04 01 02 03 04 - 00 00 00	// ? stop
      - Drives four servos at once  - that same direction and speed

    - other strange: ? 3 wheels - to check
        `[0x07, 0x03, servoId1, servoId2, servoId3, direction(0?|1|2), velocity_hi, velocity_lo]`
        sniffed:
         `[0x07, 0x03, 0x01, 0x02, 0x03, 0x01, 0x01, 0x54]`
    - Six (3 pairs) - to be tested
        `[0x07, 0x06, servoId1, servoId2, servoId3, servoId4, servoId5, servoId6, direction(0?|1|2), velocity_hi, velocity_lo]`

    - Rotation timeout: any rotation command expires after ~6 seconds unless refreshed; resend to keep spinning.
    - ACK/notify example after rotation: `fb bf 06 07 00 0d ed`. (cmd: 07 00)
    - Blocking servo ID1 during continuous rotation did **not** produce a 0x05 error report; observed responses included short acks (`0700`). Unplugging the servo produced a longer frame `07 01 00 00 00 01` (meaning unknown, likely “servo missing”).

- Servo positions (`0x09`): selector + can move multiple servos at once.
  - Payload (tested): `[0x09, sel32_25, sel24_17, sel16_9, sel8_1, s1, s2, s3, s..., speed, 0, 0]`.
  - `sel*` form a bitmask of target servos; `sel8_1` lowest byte selects IDs 1-8 (e.g., `0x07` selects 1,2,3). If no servo is selected the command is ignored. 
  - number of `s*` depend number of selectecd servos. If 1 selected - s1, if 3 s1,s2,s3 ect. Data is featched from lowes ID servo to bigest.
  - Positions: 0-252, with ~120 as center. After the command, selected servos hold position.
  - `speed` is a single byte; speed/20 = second for movments, from current to desired position
  - last two bytes remain unknown; `[0x01,0x90]` seen in sniffing, `[0x00,0x00]` also works, no visible impact in current tests
  - Observed notification/response after `0x09` write: `cmd=0x09`, params `0x00` (len=1) appears to be an OK/ack for the command.

  - sniffed example :
      `[0x09, 00 00 00 0f 20 78 78 78 14 01 90]`
      `[0x09, 00 00 00 01 11 05 00 64]`
  - Error/absent servo: unplugging servo ID1 produced `09 01 00 00 00 01` (len=6) when commanding position; normal acks were `09 00`.

- Read servo position (`0x0B`):
  - Single read: `[0x0B, servoId, 00]` returns frame: 01 aa 00 00 00 <angle>
  - All read: `[0x0B, 00, 00]` returns frames for every connected servo
  - Counterclockwise rotation decreases the reported value; values below ~120 indicate CCW rotation relative to center.
  - Reading a servo position releases its hold (a held servo after a set-position will unlock when read).
  - read all - best method to STOP all movment!

- Sensors read: (`0x7E`) 
  to work sensor need to be ENBALED, by "ENABLE" cmd, once per connection during boot sequence.
  - query single sensor (`0x7E, 0x01, type, ID`): 
     type = 0x01 - IR,
            0x06 - Ultrasonic
      ID - id of selected sensor
    - response: `[0x7E 010101 06 000105c7]`
        0x7E - response for cmd 0x7e
        0x01 0x01 0x01- single read ??
        0x06 - type of read: ultrasonic
        0x00 - ignore
        0x01 - ID of sensor
        last 2 bytes = result for ultrasonic. (16-bit int) => value /10 = range in cm. if =0 then out of range.
  - query 2 sensors: (`0x7E, 0x02, type1, ID1 , type2, ID2`)
      query 2 sensors at time, 
        type1, ID1 - first sensor (type1 as type descriped above)
        type2, ID2 - second sensor 
      WARNING, simulationus reading of 2 sensors of that same type not posible!,
          only last sensor of that type returned, package shorter that because missing data
    response: 
       `[0x7E, 010102 01 00010a9c 06 000100aa]`
        0x7E - response for cmd 0x7e
        010102 - dual read?
        next par (type 1 byte, value 4 bytes 32bit int):
          01 - type IR
          0001 - igonre
          0a9c - value of IR
          06
          0x00 - ignore
          0x01 - ID of sensor
          00aa - value of Ultrasonic

  - query multiple sensors (to check) (`0x7E, number of sensors , (type, ID) ,  ...`)
       part (type, ID) should repeat x number of sensors
       ** WARNING, simulationus reading of 2 sensors of that same type not posible! **,
          only last sensor of that type returned, package shorter that because missing data
       query: `[0x7e 0x03 0x01 0x01 0x01 0x02 0x06 0x01]`
       response 3 sensors (sniffed, IR 1,2, Ultrasonic): WRONG! (missing data for first IR sensor)
         `[0x7e 0x01 0x01 0x03 0x01 0x00 0x02 0x08 0xdf 0x06 0x00 0x01 0x00 0x68]`
         0x7e 
         0x01 0x01 0x03 - 3 sensor query
         0x01 0x02 0x00 0x00 0x00   - IR ID2 = 0000
         0x06 0x00 0x01 0x00 0x6a   - US ID1 = 006a
         **MISSING IR ID1 !

  - scan from orginal app:
    - query hex: 7E 02 01 01 06 01  (IR ID1, Ultrasonic ID1)
    - reponse hex: 7E 01 01 02 01 00 01 0a 8d 06 00 01 00 b8
  - scan, 1 ultrasonic connected
    - query hex: 7E 01 06 01  (every 200 ms)
    - resposne:  7E 01 01 01 06 00 01 05 c7
    -  variants  7E 01 01 01 06 00 01 05 c9
                 7E 01 01 01 06 00 01 00 59
  - Absent sensor behavior: unplugging IR1 or US1 still returned short frames (`7e0101010101000000` and `7e0101010601000000` respectively); no distinct error code observed.



  - Eyes/LED colors (`0x79`): 
  
    Single color:
      `[0x79, 0x04, eyesMask(<bit ID: binary mask>), time, 0x01, 0xFF, R, G, B]`; also supports multi-color masks.
      - eyemask -  bitmask of eye IDs (0x01 = ID1, 0x02 = ID2, 0x03 = both, etc.).
      - time : how long LED shoud be on in sec +1, 0xff - unlimited

      - Round eye 8 segment.
        sniffed: Eye ID=1, full color
        single color
          0x79, 04 01 ff 01 ff ff 00 00
          0x79, 04 01 ff 01 ff ff f0 00
          0x79, 04 01 ff 01 ff 00 ff 00
          0x79, 04 01 ff 01 ff 00 00 ff
          0x79, 04 01 00 01 ff 00 00 00
          response: 0x79, 0x04, 0x01 0x00

    Multicolor (segments)
      `[0x79, 0x04, eyeMask, time, count, [R, G, B, segMask] x count]`
          - eyeMask: bitmask of eye IDs (0x01 = ID1, 0x02 = ID2, 0x03 = both, etc.).
          - time: duration; 0xFF behaves as "no auto-off".
          - count: number of segment/color entries that follow.
          - Each entry: R, G, B, segMask where segMask is a bitmask of eye segments (0x01..0x80, or combinations).

      sniffed multicolor  Eye ID=1, select color for every led:
        `[0x79, 0x04, 0x01, 0x02, 0x07, 0x05, 0xff, 0xf0, 0x00, 0x02, 0xff, 0x80, 0x00, 0x08, 0x00, 0xff, 0x00, 0x10, 0x00, 0xff, 0xff, 0x20, 0x00, 0x00, 0xff, 0x40, 0xff, 0x00, 0xff, 0x80, 0xff, 0xff, 0xff]`
        `[0x79, 0x04, 0x01, 0x02, 0x04, 0xa5, 0xff, 0xf0, 0x00, 0x42, 0xff, 0x00, 0xff, 0x08, 0x00, 0x00, 0xff, 0x10, 0xff, 0xff, 0xff]`
        `[0x79, 0x04, 0x01, 0x02, 0x03, 0xad, 0xff, 0xf0, 0x00, 0x42, 0xff, 0x00, 0xff, 0x10, 0xff, 0xff, 0xff]`
  
    - Ultrasonic eye: (type = 0x06)
      `[0x79, 06 01 red green blue level 00 ff ff]` 
        - red, green, blue = color RGB
        - level : 0 - off, 1 - bright, 2+ - dimm  (use 1)
        response: 
          -  `[0x79, 0x06, 0x01, 0x00]`  - OK
          -  `[0x79, 0x06, 0x01, 0x01]`  - ERROR, disconnected
      - sniffed example
      `[0x79, 06 01 ff 00 00 01 00 ff ff]`   // ID=1 (red)
      `[0x79, 06 01 ff ae d5 01 00 ff ff]`   // ID=1 all colors on red > blue > green 
      - response: `[0x79, 0x06, 0x01, 0x00]` OK 

  - Eye animation (`0x78`): `[0x78, 0x04, eyesMask, animationId, 0x00, repetitions, R, G, B]`.
      - eyeMask: bitmask of eye IDs (0x01 = ID1, 0x02 = ID2, 0x03 = both, etc.).
      - animationId:
         * 0 - white blink full
         * 1 - white line blink
         * 2 - white up to half blink
         * 3 - white up shake
         * 4 - white midle to up move
         * 5 - white rotate clock wise
         * 6 - white down blinl
         * 7 - whute line to full blink
         * 8 - dim in / out full
         * 9 - fast blink
         * 10 - fast fan
         * 11 - low whiper
         * 12 - rainbow fan
         * 13 - rainbow blinking
         * 14 - full red/green/blue
         * 15 - rainbow building
      - Color bytes matter: R/G/B change the visible color for these animations (tested with eye ID1). `0,0,0` renders as the same white baseline as `255,255,255`; non-zero single channels do change hue (e.g., `255,0,0` = red).
      - Error acks: when the eye is connected, responses to 0x78 are short acks `78 04 01 00`; when the eye is unplugged, they return `78 04 01 01` (status=0x04, deviceId=1, detail=1). A 0x71 enable on the eye also yields `71 04 01 00` when present.
      sniffed:  // Eye ID 1, diffrent animations
         0x78, 04 01 0c 0003000000
         0x78, 04 01 0f 0003000000
         0x78, 04 01 0e 0003000000
         0x78, 04 01 0d 0003000000
        response: 0x78, 040100

  
- Misc test payload: `[0x06, 0x36, 0x00, 0x3C]`.

- Motor rotation ('0x90'): TO check
  - send: `[0x90, 0x01, motor ID, speed HI, speed LO, time hi, time lo]` 
        * motor ID 
        * [speed HI,speed LO] 16-bit int. 
            >0 rotate Clock wise, 
            <0 rotate conter clock wise, 
            0= stop,
            max speed +/- 150, anything more not make it faster
        * duration is in 0.1s ticks (e.g. 100ms => 1 tick, 1000ms => 10 ticks, max 6000ms => 60 ticks)
        * [time hi,time lo] 16 biy unsigned int / 10 = seconds of rotation
          max time is 6 second (60). Anything more, is 6 second
      resp: `[0x90, 0x00]` -> OK
      resp: `[0x90, 0x01, 0x01, 0x01]` -> Error motor 01
  - example: `[0x90, 0x01, 0x01, 0xff, 0x92, 0xff, 0xff]` // move motor ID1, ccw, 6 sec,
    - response: `[0x90, 0x00]` -> OK
    - error response: `[0x90, 0x01, 0x01, 0x01]` -> Error motor 01
       means-> motor 01 error.
       after notification ERROR 0x05 follows

  - dual motor
    - send: `[0x90, 0x01, <MotorID bit mask> , speed1 HI, speed1 LO, time1 hi, time1 lo, speed2 HI, speed2 LO, time2 hi, time2 lo]`
        <MotorID bit mask> - 1 for ID1, 2 for ID2, ... , 3 for ID1+ID2, | 2 selected !
        speed1 HI, speed1 LO, time1 hi, time1 lo - that same meaning as for single motor, (first motor)
        speed2 HI, speed2 LO, time2 hi, time2 lo - that same meaning as for single motor, (second motor)
        motor odrdered from lowes ID

    - sniffed examples (motor ID1 and ID2)
      `[0x90, 0x01, 0x03, 0xff, 0xfc, 0xff, 0xff, 0xff, 0xda, 0xff, 0xff]`
      `[0x90, 0x01, 0x03, 0x00, 0x0a, 0xff, 0xff, 0x00, 0x31, 0xff, 0xff]`
  - Error/absent motor: unplugged motor ID1 returned `90 01 01 01` (status=0x01, deviceId=1, detail=1) instead of `90 00`.
---

-  set??? (`0x91`) - don't know, variants | clear error?
    - send`[0x91, 0x01, 0x01]` ??? | clear error?
      - response hex: `[91 00]`  
    - send: '`[0x91, 0x01, 0x03]` ???  | clear error?
      - response hex: `[91 00]`  

-  set??? (`0x92`) - don't know,  | clear error?
    - send`[0x92, 0x00]` ???
      - response hex: `[91 00]`  

-  set??? (`0x3b`) - don't know,  | clear error?
    - send`[0x3b, 0x00]` ???
      - response hex: `[3b 00]`  

---
-  Change ID (`0x74`) - change ID of IR, ultrasonic, :
    - meaning [0x74, <device type>, <from ID>, <to ID>]
      device types: 
         0x01 - IR
         0x04 - Eye
         0x06 - Ultrasonic
         0x0a - Motor 
    - FIX if <from ID> = 0 it is  posible to "fix" bad ID for not visible module
    sniffed:
    - `[0x74, 0x01, 0x01, 0x02]` IR sensor 01 -> 02
    - response hex: `[74 01 01 00]`  
    - `[0x74, 0x01, 0x02, 0x01]` IR sensor 02 -> 01
    - response hex: `[74 01 02 00]`  
    
-  Change SERVO ID (`0x0C`) - change ID of servo 
    - meaning [0x0C, <from ID>, <to ID>]
    - TO TEST: if <from ID> = 0 it should be posible to "fix" bad ID for not visible serve
    sniffed:
       command:  `[0x0c, 0x01, 0x06]`
       response: `[0x0c, 0x0]`

- Gaps/risks:
  - UUIDs, MTU, and characteristic order are not fixed in the repo.
  - Touch/color/other sensors are untested (we only have servos, motors, IR, ultrasonic, speakers, segment eyes).
  - Speaker is a standard Bluetooth audio device; not controlled via these commands (only detected in 0x08/0x71 mask).
  - Module addressing:
    - Modules have per-type IDs starting at 1 (servo 1, motor 1, eye 1, IR 1, ultrasonic 1, etc.). IDs are unique within a type; type + ID is the unique address. This matches the official wired Arduino library and is likely true over BLE; ensure BLE payloads carry the target module id.


## Expected device layout (to verify/expand)
- Likely a single primary service with vendor-specific UUID (commonly 0xFFE0/0xFFE1 style or 128-bit custom); verify with nRF Connect.
- One write characteristic for commands; one notify characteristic for responses/events (in the repo they are characteristics[0] write, [1] notify).
- Device advertises a name containing `JIMU` and may expose hardware/firmware/version characteristics (not documented in repo).

## Working command model (proposed)
- Session setup:
  - Connect, set MTU if supported (try 247), subscribe to notifications.
  - Send a handshake/ping to confirm link.
- Boot sequence:
  - cmd 0x36 -> board INFO
  - cmd 0x01 -> start scan
  - cmd 0x08 -> detect / list all detected modules (remember all detected modules)
  - cmd 0x05 -> check for errors
  - cmd 0x71 -> enable all detected modules (that need enable)
  - cmd 0x27 -> check battery voltage and charging status
  - Cache module map for block toolboxes and validation.
- servo angleDeg representation
  - on-wire raw range is typically 0..240; the app/SDK uses degrees in -120..120, with 0 as neutral (center)
  - conversion: `deg = raw - 120`, `raw = deg + 120` (clamp to bounds)
- Actuation (examples to design/verify):
  - `setServoPosition(id, angleDeg, durationMs)`.
  - `rotateServo(id, direction, speedPct)` and `powerDownServo(id)`.
  - `rotateMotor(id, direction, speedPct)` and `powerDownMotor(id)`.
  - `eyeColor(id,R,G,B,duration)`
  - `eyeColorSegment(id,[R,G,B],[R,G,B],[R,G,B],[R,G,B],[R,G,B],[R,G,B],[R,G,B],[R,G,B],duration)`
  - `ultrasonicColor(id,R,G,B,duration)`
  - Control panel outputs: `setLed(id, color)` or `setIndicator(id, value)` if supported.
- Sensors (examples):
  - `readUltrasonic(id) -> distance`.
  - `readIR(id) -> proximity/white level`.
  - `readTouch(id) -> pressed, double pressed, long pressed`.
  - `readServoPosition(id) -> { id, raw, deg }` (and the SDK emits `servoPosition` events in the same units).
  - `readBattery() -> voltage`.
  - `readBatteryCharge() -> bool`.
  - Control panel inputs: 
     - button - start code block
     - switch - on/off - `readSwitch(id) -> bool`
     - slider - readSlider(id) -> value, 
     - joystick (2-way) `readJoystickX(id)` `readJoystickX(id)`, + code executed when changed
     - timmer - start code block every X seconds.
     - run - code block executed when model is started.
  - Control panel hardware inputs:
    - events: key pressed
    - joystick data, sticks position and button pressed
- Events:
  - Notifications for module changes, low battery, and possibly control panel widget changes.


## Cross-reference: official wired uKitExplore library (direct bus)
- Uses the same start/end sentinels `0xFB ... 0xED` but different framing:
  - Second byte is a module-class “head” (e.g., `0xFA` for servos; `0x10/0x06/0x05/0x03` for other devices) with a bit-swapped copy; payload includes module ID (per type, starting at 1).
  - Length and checksum differ: many helpers use CRC8-ITU over `[head..payload]`, some use a simple sum; `0xED` terminates.
  - Commands are per module type (servo read/write, ultrasonic/IR/color/button/eye light). Servo get-position responses map roughly to -120..+120 range.
- Implication for BLE:
  - BLE packets in node-jimu do not expose the module “head” byte, but likely still include a module ID in the params (e.g., `motorId` in `0x07`, servo id(s) in `0x09/0x0B`).
  - Unknown tail fields in BLE payloads (e.g., last two bytes of `0x09`) may correspond to control bytes/checksums seen in wired frames; verify with captures.
  - When gaps exist in node-jimu docs, prefer the wired patterns for ID usage and sentinel/checksum expectations, but confirm against BLE traffic.

## Security/permissions
- Pairing is usually Just Works. Ensure bonding is optional and handle rejected write permissions gracefully.
- Provide a reconnect loop with exponential backoff and UI status.

## TODO after sniffing
- Lock down service/characteristic UUIDs and confirm characteristic order.
- Measure timing limits (min command spacing, notification rate) and update runtime throttling/backoff.
- Define sensor response parsing (offsets, units) and eye/light masks.

## BLE timing observations (Dec 2025)
- Testing battery queries (0x27) in bursts of 30 frames: 25–50 ms gaps delivered 0 drops; 10 ms caused 10/30 missing responses; 5 ms caused 8/30 missing responses. Runtime writes should clamp to ~25 ms minimum for reliability; faster rates need retries/backoff.
- Observed notification cadence over the sweep: p50 ≈ 60 ms, p95 ≈ 240 ms, max ≈ 1.38 s with occasional back-to-back frames (min 0). Plan for jitter and buffer draining rather than strict periodicity.
- Error query (0x05, 0x00) returns `[05 00]` when no faults are present; not a fault condition.
- Sensor read timing (IR/US/servo position ID1; bursts of 30 per gap):
  - Stable at 50–200 ms gaps (0 drops). At 25 ms gaps: IR dropped 4/30, US dropped 3/30, servo dropped 1/30. At 10 ms gaps: IR dropped 12/30, US dropped 13/30, servo dropped 10/30.
  - Latency: for 50–100 ms gaps p50 ~70–90 ms; at 25 ms gaps p50 ~270–320 ms (p95 ~440–500 ms); at 10 ms gaps p50 ~300–330 ms (p95 ~575–603 ms).
  - Ultrasonic sometimes emitted extra notifications (e.g., 46/30 at 200 ms gap), so correlate by command byte, not just counts.
