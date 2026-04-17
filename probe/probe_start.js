#!/usr/bin/env node
/**
 * Interactive starter probe:
 * - Connects to a JIMU brick.
 * - Streams and parses every response frame (0x08, 0x7E, battery, etc).
 * - Lets you send boot-sequence frames.
 * - ENABLE helper builds 0x71 frames from the latest 0x08 map.
 * - Eye test and sensor reads (IR/ultrasonic/all).
 */
import readline from 'readline';
import { JimuBleClient } from '../jimu/jimu_ble.js';

const info = console.log;
const warn = console.warn;
const error = console.error;

const bootCommands = [
  { label: 'Brick info (0x36,0x00)', payload: [0x36, 0x00] },
  { label: 'Brick probe devices (0x01,0x00)', payload: [0x01, 0x00] },
  { label: 'Brick status map (0x08,0x00)', payload: [0x08, 0x00] },
  { label: 'Init? keep (0x05,0x00)', payload: [0x05, 0x00] },
  { label: 'Init? optional (0x72,0x08,0x01)', payload: [0x72, 0x08, 0x01] },
  { label: 'Battery (0x27,0x00)', payload: [0x27, 0x00] },
  { label: 'Board cfg? (0x2c,0x00)', payload: [0x2c, 0x00] },
  { label: 'Board serial? (0x2b,0x07)', payload: [0x2b, 0x07] },
  { label: 'Ping (0x03,0x00)', payload: [0x03, 0x00] },
];

const bootOrder = bootCommands.map((_, idx) => idx); // default: all in listed order

const eyeCommands = {
  red: {
    label: 'Eye ID1 full red',
    payload: [0x79, 0x04, 0x01, 0xff, 0x01, 0xff, 0xff, 0x00, 0x00],
  },
  off: {
    label: 'Eye ID1 off',
    payload: [0x79, 0x04, 0x01, 0x00, 0x01, 0xff, 0x00, 0x00, 0x00],
  },
};

const clampByte = (v) => ((v % 256) + 256) % 256;
const toHex = (v) => `0x${clampByte(v).toString(16).padStart(2, '0')}`;
const payloadHex = (payload) => payload.map((b) => toHex(b)).join(' ');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (question) =>
  new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });

const pickDevice = async () => {
  info('Scanning for JIMU devices (5s)...');
  const devices = await JimuBleClient.scan({ timeoutMs: 5000 });
  if (!devices.length) {
    warn('No devices found. Is the brick on and advertising?');
    return null;
  }
  devices.forEach((d, idx) => info(`${idx + 1}. ${d.name || 'Unknown'} (${d.id})`));
  const ans = await ask('Pick device number (Enter=1st): ');
  const num = parseInt(ans, 10);
  const choice = Number.isInteger(num) && num >= 1 && num <= devices.length ? devices[num - 1] : devices[0];
  return choice.peripheral;
};

const showMenu = () => {
  info('\nCommands:');
  info('  list                -> show boot frames');
  info('  send <idx...|all>   -> send selected boot frames in sequence');
  info('  status              -> request 0x08 status map');
  info('  enable              -> send 0x71 for all detected devices (uses last 0x08)');
  info('  sensor ir|us|all    -> read sensors (IR1, Ultrasonic1, or all detected)');
  info('  eye red | eye off   -> LED eye ID1 full red / off');
  info('  eye seg             -> multi-color eye test (guessed format)');
  info('  fixir               -> attempt to recover IR with ID0 -> set to ID2 (0x74)');
  info('  help                -> show this help');
  info('  exit                -> disconnect and quit');
};

const sendSequence = async (client, indices, label = 'selected') => {
  for (const i of indices) {
    const entry = bootCommands[i];
    if (!entry) {
      warn(`Skipping unknown index ${i}`);
      continue;
    }
    info(`=> ${entry.label}: [${payloadHex(entry.payload)}]`);
    await client.send(entry.payload);
    await new Promise((r) => setTimeout(r, 150));
  }
  info(`Finished sending ${label} frames.`);
};

const maskByteToIds = (byte = 0) => {
  const ids = [];
  for (let i = 0; i < 8; i += 1) {
    if (byte & (1 << i)) ids.push(i + 1);
  }
  return ids;
};

const maskBytesToIds = (bytes = []) => {
  // bytes ordered as [b12, b13, b14, b15] mapping bits [id32..id1]
  const ids = [];
  const len = bytes.length;
  bytes.forEach((b, idx) => {
    const offset = (len - idx - 1) * 8; // b15 -> +0, b12 -> +24
    maskByteToIds(b).forEach((id) => ids.push(id + offset));
  });
  return ids;
};

const idsToMaskByte = (ids = []) => {
  let mask = 0;
  ids.forEach((id) => {
    const bit = (id - 1) % 8;
    mask |= 1 << bit;
  });
  return clampByte(mask);
};

const parseStatus08 = (payload) => {
  if (!payload?.length || payload[0] !== 0x08) return null;
  const safe = (idx) => (idx < payload.length ? payload[idx] : 0);
  const servoBytes = [safe(12), safe(13), safe(14), safe(15)];
  const irByte = safe(29);
  const eyeByte = safe(50);
  const usByte = safe(64);
  const speakerByte = safe(78);
  const motorByte = safe(120);
  const text = Buffer.from(payload.slice(1, Math.min(payload.length, 12)))
    .toString('ascii')
    .replace(/\0+$/, '');
  return {
    text,
    servos: maskBytesToIds(servoBytes),
    ir: maskByteToIds(irByte),
    eyes: maskByteToIds(eyeByte),
    ultrasonic: maskByteToIds(usByte),
    speakers: maskByteToIds(speakerByte),
    motors: maskByteToIds(motorByte),
    masks: {
      servos: servoBytes,
      ir: irByte,
      eyes: eyeByte,
      ultrasonic: usByte,
      speakers: speakerByte,
      motors: motorByte,
    },
  };
};

const formatList = (arr) => (arr.length ? arr.join(',') : 'none');
const describeStatus = (status) => {
  if (!status) return 'No status parsed yet.';
  return [
    status.text ? `fw: ${status.text}` : '',
    `servos: ${formatList(status.servos)}`,
    `IR: ${formatList(status.ir)}`,
    `eyes: ${formatList(status.eyes)}`,
    `ultrasonic: ${formatList(status.ultrasonic)}`,
    `speakers: ${formatList(status.speakers)}`,
    `motors: ${formatList(status.motors)}`,
  ]
    .filter(Boolean)
    .join(' | ');
};

const parseSensors7e = (payload) => {
  if (!payload?.length || payload[0] !== 0x7e) return null;
  const count = payload[3] || 0;
  const readings = [];
  for (let i = 0; i < count; i += 1) {
    const off = 4 + i * 5;
    if (off + 5 > payload.length) break;
    const type = payload[off];
    const id = payload[off + 2]; // second "ignored" byte carries sensor ID
    const raw = Buffer.from(payload.slice(off + 1, off + 5));
    const value = raw.slice(-2).readUInt16BE(0); // spec: first two bytes ignored, last two = 16-bit value
    readings.push({ type, id, value, raw: Array.from(raw) });
  }
  return { count, readings };
};

const typeName = (t) => {
  if (t === 0x01) return 'IR';
  if (t === 0x06) return 'US';
  return `0x${t.toString(16)}`;
};

const buildEyeSegmentsPayload = (colors = [], { eyeMask = 0x01, time = 0x05 } = {}) => {
  // Sniffed multi-color format:
  // 0x79, 0x04, eyeMask, 0x02, count, time, [R, G, B, mask] x count
  // mask is the segment bitmask (0x01..0x80 or combinations).
  const entries = colors
    .map((c, idx) => {
      if (!c) return null;
      const { r, g, b, mask } = c;
      const m = mask ?? (1 << idx); // default mask bit per segment
      return [clampByte(r ?? 0), clampByte(g ?? 0), clampByte(b ?? 0), m & 0xff];
    })
    .filter(Boolean);
//  const payload = [0x79, 0x04, eyeMask & 0xff, 0x02, clampByte(entries.length), clampByte(time)];
  const payload = [0x79, 0x04, eyeMask & 0xff, 0xff, clampByte(entries.length), clampByte(time)];
  entries.forEach((e) => payload.push(...e));
  return payload;
};

const defaultEyeSegments = () => {
  // Default to both eyes (mask=0x03) and long time (0xff) using the sniffed color entries.
  const eyeMask = 0x03; // Eyes 1+2
  const time = 0xff; // try to avoid quick timeout
  const colors = [
    { r: 0xff, g: 0xf0, b: 0x00, mask: 0x02 },
    { r: 0xff, g: 0x80, b: 0x00, mask: 0x08 },
    { r: 0x00, g: 0xff, b: 0x00, mask: 0x10 },
    { r: 0x00, g: 0xff, b: 0xff, mask: 0x20 },
    { r: 0x00, g: 0x00, b: 0xff, mask: 0x40 },
    { r: 0xff, g: 0x00, b: 0xff, mask: 0x80 },
    { r: 0xff, g: 0xff, b: 0xff, mask: 0xff },
  ];
  return buildEyeSegmentsPayload(colors, { eyeMask, time });
};

const attachLogging = (client, state, rePrompt) => {
  client.on('frame', ({ payload, meta }) => {
    const hex = payloadHex(Array.from(payload));
    const status = meta?.checksumOk ? 'ok' : 'bad';
    info(`<= cmd=${toHex(meta?.cmd)} len=${meta?.lenByte} checksum=${status} | ${hex}`);

    if (meta?.cmd === 0x08) {
      state.status08 = parseStatus08(Array.from(payload));
      info(`   status: ${describeStatus(state.status08)}`);
    }
    if (meta?.cmd === 0x27 && payload.length >= 5) {
      const charging = payload[1] === 1 ? 'charging' : 'discharging';
      const volts = (payload[3] * 256 + payload[4]) / 2500;
      info(`   battery: ${charging}, v=${volts.toFixed(3)} (raw ${payload[3]}/${payload[4]})`);
    }
    if (meta?.cmd === 0x7e) {
      const parsed = parseSensors7e(Array.from(payload));
      if (parsed) {
        const parts = parsed.readings.map((r) => `${typeName(r.type)}${r.id ? r.id : ''}=${r.value}`);
        info(`   sensors (${parsed.count}): ${parts.join(', ') || 'none'}`);
      }
    }
    rePrompt();
  });
  client.on('frameError', (err) => {
    warn(`Frame error: ${err.message}`);
    rePrompt();
  });
  client.on('disconnect', () => {
    warn('Disconnected.');
    rePrompt();
  });
};

const main = async () => {
  const state = { status08: null, shuttingDown: false };
  const client = new JimuBleClient();
  const rePrompt = () => {
    if (state.shuttingDown) return;
    if (rl && typeof rl.prompt === 'function') {
      rl.prompt(true);
    }
  };
  attachLogging(client, state, rePrompt);

  const shutdown = async (code = 0) => {
    if (state.shuttingDown) return;
    state.shuttingDown = true;
    try {
      await client.disconnect();
    } catch (_) {
      // ignore
    }
    try {
      rl.close();
    } catch (_) {
      // ignore
    }
    setTimeout(() => process.exit(code), 100);
  };

  try {
    const peripheral = await pickDevice();
    if (!peripheral) {
      await shutdown(1);
      return;
    }
    info('Connecting...');
    await client.connect(peripheral);
    info('Connected. Listening for notifications.');
  } catch (e) {
    error(`Connect failed: ${e.message}`);
    await shutdown(1);
    return;
  }

  showMenu();
  info('\nBoot frames:');
  bootCommands.forEach((c, idx) => info(`  [${idx}] ${c.label} -> ${payloadHex(c.payload)}`));
  rl.setPrompt('probe> ');
  rl.prompt();

  const handleLine = async (line) => {
    const [cmd, ...rest] = line.trim().split(/\s+/).filter(Boolean);
    if (!cmd || cmd === 'help') {
      showMenu();
      return;
    }
    if (cmd === 'exit' || cmd === 'quit' || cmd === 'q') {
      await shutdown(0);
      return;
    }
    if (cmd === 'list' || cmd === 'ls') {
      bootCommands.forEach((c, idx) => info(`  [${idx}] ${c.label} -> ${payloadHex(c.payload)}`));
      return;
    }
    if (cmd === 'send') {
      if (!rest.length) {
        warn('Usage: send all | send 0 1 2');
        return;
      }
      const targets =
        rest[0] === 'all'
          ? bootOrder
          : rest
              .map((t) => parseInt(t, 10))
              .filter((n) => Number.isInteger(n) && n >= 0 && n < bootCommands.length);
      if (!targets.length) {
        warn('No valid indices provided.');
        return;
      }
      await sendSequence(client, targets, rest[0] === 'all' ? 'all boot' : 'selected');
      return;
    }
    if (cmd === 'status') {
      info('=> Requesting status (0x08)...');
      await client.send([0x08, 0x00]);
      return;
    }
    if (cmd === 'enable') {
      if (!state.status08) {
        warn('No 0x08 status yet. Run "status" first to detect devices.');
        return;
      }
      const enableSet = [
        { type: 0x01, name: 'IR', mask: idsToMaskByte(state.status08.ir) },
        { type: 0x04, name: 'Eye', mask: idsToMaskByte(state.status08.eyes) },
        { type: 0x06, name: 'Ultrasonic', mask: idsToMaskByte(state.status08.ultrasonic) },
        { type: 0x08, name: 'Speaker', mask: idsToMaskByte(state.status08.speakers) },
      ].filter((x) => x.mask);
      if (!enableSet.length) {
        warn('No IR/Eye/Ultrasonic/Speaker detected in last 0x08.');
        return;
      }
      for (const cfg of enableSet) {
        const payload = [0x71, cfg.type, cfg.mask, 0x00];
        info(`=> ENABLE ${cfg.name} mask=${toHex(cfg.mask)} : [${payloadHex(payload)}]`);
        await client.send(payload);
        await sleep(150);
      }
      return;
    }
    if (cmd === 'sensor') {
      const which = rest[0];
      if (!which) {
        warn('Usage: sensor ir | sensor us | sensor all');
        return;
      }
      if (which === 'ir') {
        const payload = [0x7e, 0x01, 0x01, 0x01];
        info(`=> Read IR ID1: [${payloadHex(payload)}]`);
        await client.send(payload);
        return;
      }
      if (which === 'us' || which === 'ultra' || which === 'ultrasonic') {
        const payload = [0x7e, 0x01, 0x06, 0x01];
        info(`=> Read Ultrasonic ID1: [${payloadHex(payload)}]`);
        await client.send(payload);
        return;
      }
      if (which === 'all') {
        if (!state.status08) {
          warn('No 0x08 status yet. Run "status" first to detect devices.');
          return;
        }
        const sensors = [
          ...state.status08.ir.map((id) => ({ type: 0x01, id })),
          ...state.status08.ultrasonic.map((id) => ({ type: 0x06, id })),
        ];
        if (!sensors.length) {
          warn('No IR/Ultrasonic sensors detected in last 0x08.');
          return;
        }
        // WARNING from protocol: cannot read two sensors of same type in one 0x7E; batch per type.
        const queue = [...sensors];
        let batchNum = 1;
        while (queue.length) {
          const batch = [];
          const seenTypes = new Set();
          for (let i = 0; i < queue.length; ) {
            const s = queue[i];
            if (seenTypes.has(s.type)) {
              i += 1;
              continue;
            }
            seenTypes.add(s.type);
            batch.push(s);
            queue.splice(i, 1);
          }
          const payload = [0x7e, clampByte(batch.length)];
          batch.forEach((s) => payload.push(s.type, s.id));
          info(`=> Read sensors batch ${batchNum}: [${payloadHex(payload)}]`);
          await client.send(payload);
          await sleep(120);
          batchNum += 1;
        }
        return;
      }
      warn('Usage: sensor ir | sensor us | sensor all');
      return;
    }
    if (cmd === 'eye') {
      const sub = rest[0];
      const eyeCmd =
        sub === 'red'
          ? eyeCommands.red
          : sub === 'off'
          ? eyeCommands.off
          : sub === 'seg'
          ? { label: 'Eye ID1 multi-color (guessed)', payload: defaultEyeSegments() }
          : null;
      if (!eyeCmd) {
        warn('Usage: eye red | eye off | eye seg');
        return;
      }
      info(`=> ${eyeCmd.label}: [${payloadHex(eyeCmd.payload)}]`);
      await client.send(eyeCmd.payload);
      return;
    }
    if (cmd === 'fixir') {
      const payload = [0x74, 0x01, 0x00, 0x02]; // Change ID: IR from 0 -> 2
      info(`=> Recover IR ID0 -> ID2: [${payloadHex(payload)}]`);
      await client.send(payload);
      return;
    }

    warn(`Unknown command: ${cmd}`);
    showMenu();
  };

  rl.on('line', (line) => {
    handleLine(line).catch((err) => {
      error(`Command error: ${err.message}`);
    }).finally(() => {
      rePrompt();
    });
  });
};

main().catch((e) => {
  error(e);
  try {
    rl.close();
  } catch (_) {
    // ignore
  }
  setTimeout(() => process.exit(1), 100);
});
