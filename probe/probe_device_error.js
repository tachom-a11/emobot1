#!/usr/bin/env node
// Device presence/error probe for IR, Ultrasonic, and Motor ID1.
// Sends simple commands and logs all frames/error acks to see how the brick reports absent/blocked devices.
// Controls:
//   i = read IR (0x7E, type=0x01, id=1)
//   u = read Ultrasonic (0x7E, type=0x06, id=1)
//   m = spin motor (0x90, id=1, speed=80, time=1s) – block or unplug to test error
//   s = stop motor (0x90, id=1, speed=0)
//   q = quit
// Env: JIMU_TARGET=<name/id substring>
import { Jimu } from '../jimu/jimu.js';
import { JimuBleClient } from '../jimu/jimu_ble.js';

const TARGET = (process.env.JIMU_TARGET || '').toLowerCase();
const MOTOR_SPEED = 80; // % (approx; library maps to signed 16-bit)
const MOTOR_TIME_MS = 1000; // 1 second

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
    console.log('Connected. Refreshing status and enabling sensors...');
    await jimu.refreshStatus();
    await jimu.enableDetected();
  } catch (e) {
    console.error('Connect failed:', e.message);
    process.exit(1);
  }

  jimu.on('frame', ({ payload, meta }) => {
    console.log(`<= cmd=0x${meta?.cmd?.toString(16)} len=${payload.length} hex=${payload.toString('hex')}`);
  });
  jimu.on('deviceError', (e) => {
    console.warn('Device error ack:', e);
  });
  jimu.on('errorReport', (e) => {
    console.warn('Error report 0x05:', e);
  });

  const readIR = async () => {
    try {
      await jimu.readIR(1);
      console.log('Sent IR read (ID1).');
    } catch (e) {
      console.error('IR read failed:', e.message);
    }
  };
  const readUS = async () => {
    try {
      await jimu.readUltrasonic(1);
      console.log('Sent Ultrasonic read (ID1).');
    } catch (e) {
      console.error('Ultrasonic read failed:', e.message);
    }
  };
  const spinMotor = async () => {
    try {
      await jimu.rotateMotor(1, MOTOR_SPEED, MOTOR_TIME_MS);
      console.log(`Sent motor spin (ID1, speed=${MOTOR_SPEED}%, time=${MOTOR_TIME_MS}ms).`);
    } catch (e) {
      console.error('Motor spin failed:', e.message);
    }
  };
  const stopMotor = async () => {
    try {
      await jimu.stopMotor(1);
      console.log('Sent motor stop (ID1).');
    } catch (e) {
      console.error('Motor stop failed:', e.message);
    }
  };

  console.log('\nControls: i=IR read, u=Ultrasonic read, m=spin motor, s=stop motor, q=quit.');
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', async (chunk) => {
    const str = chunk.toString();
    if (str === 'i') {
      await readIR();
    } else if (str === 'u') {
      await readUS();
    } else if (str === 'm') {
      await spinMotor();
    } else if (str === 's') {
      await stopMotor();
    } else if (str === 'q' || chunk[0] === 3) {
      console.log('Exiting...');
      process.stdin.setRawMode(false);
      await stopMotor();
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
