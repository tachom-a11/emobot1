#!/usr/bin/env node
// Servo error probe (position mode): send position commands (0x09) to servo ID1, listen for acks/0x05.
// Use Ctrl+C or 'q' to stop. Block the servo shaft or unplug it to see what frames appear.
// Env:
//   JIMU_TARGET=<name/id substring>
import { Jimu } from '../jimu/jimu.js';
import { JimuBleClient } from '../jimu/jimu_ble.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TARGET = (process.env.JIMU_TARGET || '').toLowerCase();
const SERVO_ID = 1;
const clampPos = (v) => Math.max(0, Math.min(252, v));

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

const main = async () => {
  const jimu = new Jimu({ pingIntervalMs: 0, batteryIntervalMs: 0 });
  try {
    const device = await selectDevice();
    if (!device) return;
    console.log(`\nConnecting to ${device.name} (${device.id})...`);
    await jimu.connect(device.peripheral || device.id);
    console.log('Connected. Refreshing status and enabling if needed...');
    await jimu.refreshStatus();
    // No explicit servo enable cmd exists; rotation should work if detected.
  } catch (e) {
    console.error('Connect failed:', e.message);
    process.exit(1);
  }

  jimu.on('frame', ({ payload, meta }) => {
    console.log(
      `<= cmd=0x${meta?.cmd?.toString(16)} len=${payload.length} hex=${payload.toString('hex')}`,
    );
  });
  jimu.on('deviceError', (e) => {
    console.warn('Device error ack:', e);
  });
  jimu.on('errorReport', (e) => {
    console.warn('Error report 0x05:', e);
  });

  let targetPos = 120; // center-ish
  const speed = 0x14;

  const sendPosition = async () => {
    try {
      await jimu.setServoPositions({ ids: [SERVO_ID], positions: [targetPos], speed, tail: [0x00, 0x00] });
      console.log(
        `Sent position id=${SERVO_ID} pos=${targetPos} speed=${speed}`,
      );
    } catch (e) {
      console.error('Send failed:', e.message);
    }
  };

  console.log('\nSending position commands to servo ID1. Block or unplug to provoke an error.');
  console.log('Controls: Enter=send, +/- to change pos by 10, [0/9]=0/252, c=center(120), q=quit.');
  await sendPosition();

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', async (chunk) => {
    const str = chunk.toString();
    if (str === '\r') {
      await sendPosition();
    } else if (str === '+') {
      targetPos = clampPos(targetPos + 10);
      console.log(`Target pos -> ${targetPos}`);
    } else if (str === '-') {
      targetPos = clampPos(targetPos - 10);
      console.log(`Target pos -> ${targetPos}`);
    } else if (str === '0') {
      targetPos = 0;
      console.log(`Target pos -> ${targetPos}`);
    } else if (str === '9') {
      targetPos = 252;
      console.log(`Target pos -> ${targetPos}`);
    } else if (str === 'c') {
      targetPos = 120;
      console.log(`Target pos -> ${targetPos}`);
    } else if (str === 'q' || chunk[0] === 3) {
      console.log('Exiting...');
      process.stdin.setRawMode(false);
      await sendPosition(); // send last target (or center if needed)
      await sleep(200);
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
