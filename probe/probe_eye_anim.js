#!/usr/bin/env node
// Interactive eye animation probe: adjust animationId with arrow up/down, Enter sends 0x78.
// Env:
//   JIMU_TARGET=<name/id substring>
import { Jimu } from '../jimu/jimu.js';
import { JimuBleClient } from '../jimu/jimu_ble.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clampByte = (v) => ((v % 256) + 256) % 256;
const TARGET = (process.env.JIMU_TARGET || '').toLowerCase();

const selectDevice = async () => {
  console.log('Scanning for JIMU devices (5s)...');
  const devices = await JimuBleClient.scan({ timeoutMs: 5000 });
  if (!devices.length) {
    console.log('No JIMU modules detected.');
    return null;
  }
  if (TARGET) {
    const match = devices.find(
      (d) => d.id.toLowerCase() === TARGET || d.name.toLowerCase().includes(TARGET),
    );
    if (match) {
      console.log(`Using preset target: ${match.name} (${match.id})`);
      return match;
    }
  }
  devices.forEach((d, idx) => console.log(`${idx + 1}. ${d.name || 'Unknown'} (${d.id})`));
  if (!process.stdin.isTTY) {
    console.log('No TTY, using first device.');
    return devices[0];
  }
  return new Promise((resolve) => {
    process.stdout.write('Choose device (Enter=1): ');
    process.stdin.resume();
    const onData = (data) => {
      const input = data.toString().trim();
      process.stdin.removeListener('data', onData);
      const choice = parseInt(input, 10);
      const picked =
        Number.isInteger(choice) && choice >= 1 && choice <= devices.length
          ? devices[choice - 1]
          : devices[0];
      resolve(picked);
    };
    process.stdin.on('data', onData);
  });
};

const render = ({ animId, reps, color }) => {
  process.stdout.write(
    `\rAnimId=${animId} (0x${animId.toString(16).padStart(2, '0')}) reps=${reps} color=[${color.join(
      ',',
    )}]  (Up/Down change ID 0-15, r/g/b +, R/G/B -, c=clear to 0, w=white, Enter send, q quit)      `,
  );
};

const main = async () => {
  const jimu = new Jimu({ pingIntervalMs: 0, batteryIntervalMs: 0 });
  let state = { animId: 0x00, reps: 0x03, color: [0xff, 0xff, 0xff] }; // start bright to see effects
  try {
    const device = await selectDevice();
    if (!device) return;
    console.log(`\nConnecting to ${device.name} (${device.id})...`);
    await jimu.connect(device.peripheral || device.id);
    console.log('Connected. Eye ID1 expected.');
    // Ensure status + enable eye ID1 explicitly (in case auto-boot missed it).
    await jimu.refreshStatus();
    await jimu.client.send([0x71, 0x04, 0x01, 0x00]); // enable eye mask=1
    await sleep(150); // let boot settle
  } catch (e) {
    console.error('Connect failed:', e.message);
    process.exit(1);
  }

  const sendAnim = async () => {
    const payload = [
      0x78,
      0x04,
      0x01, // eyesMask: ID1
      clampByte(state.animId),
      0x00, // reserved/unknown
      clampByte(state.reps),
      clampByte(state.color[0]),
      clampByte(state.color[1]),
      clampByte(state.color[2]),
    ];
    try {
      await jimu.client.send(payload);
      process.stdout.write(`\nSent: ${payload.map((b) => b.toString(16).padStart(2, '0')).join(' ')}\n`);
    } catch (e) {
      process.stdout.write(`\nSend failed: ${e.message}\n`);
    }
    render(state);
  };

  process.stdin.setRawMode(true);
  process.stdin.resume();
  jimu.on('frame', ({ payload, meta }) => {
    console.log(
      `\n<= cmd=0x${meta?.cmd?.toString(16)} len=${payload.length} hex=${payload.toString('hex')}`,
    );
    render(state);
  });
  jimu.on('deviceError', (e) => {
    console.warn('\nDevice error ack:', e);
    render(state);
  });
  jimu.on('errorReport', (e) => {
    console.warn('\nError report 0x05:', e);
    render(state);
  });
  render(state);

  process.stdin.on('data', async (chunk) => {
    const bytes = Array.from(chunk);
    const str = chunk.toString();
    if (bytes.length === 3 && bytes[0] === 0x1b && bytes[1] === 0x5b) {
      if (bytes[2] === 0x41) state.animId = Math.min(15, state.animId + 1); // up
      if (bytes[2] === 0x42) state.animId = Math.max(0, state.animId - 1); // down
      render(state);
      return;
    }
    const adjust = (idx, delta) => {
      state.color[idx] = Math.max(0, Math.min(255, state.color[idx] + delta));
    };
    if (str === 'r') {
      adjust(0, 0x20);
      render(state);
      return;
    }
    if (str === 'g') {
      adjust(1, 0x20);
      render(state);
      return;
    }
    if (str === 'b') {
      adjust(2, 0x20);
      render(state);
      return;
    }
    if (str === 'R') {
      adjust(0, -0x20);
      render(state);
      return;
    }
    if (str === 'G') {
      adjust(1, -0x20);
      render(state);
      return;
    }
    if (str === 'B') {
      adjust(2, -0x20);
      render(state);
      return;
    }
    if (str === 'c') {
      state.color = [0, 0, 0];
      render(state);
      return;
    }
    if (str === 'w') {
      state.color = [0xff, 0xff, 0xff];
      render(state);
      return;
    }
    if (str === '\r') {
      await sendAnim();
      return;
    }
    if (str === 'q' || bytes[0] === 3) {
      process.stdout.write('\nExiting...\n');
      process.stdin.setRawMode(false);
      try {
        await jimu.disconnect();
      } catch (_) {
        // ignore
      }
      process.exit(0);
    }
  });
};

main();
