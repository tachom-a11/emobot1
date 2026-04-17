#!/usr/bin/env node
// Sensor/servo timing probe: sweep read intervals for IR, Ultrasonic, and servo position (ID1).
// Env overrides:
//   JIMU_TARGET=<name/id substring>
//   JIMU_TIMING_INTERVALS=200,100,50,25,10   (ms gaps)
//   JIMU_TIMING_COUNT=30                     (commands per gap)
import readline from 'readline';
import { Jimu } from '../jimu/jimu.js';
import { JimuBleClient } from '../jimu/jimu_ble.js';

const defaultIntervals = () => {
  const env = process.env.JIMU_TIMING_INTERVALS;
  if (!env) return [200, 100, 50, 25, 10];
  const parsed = env
    .split(',')
    .map((v) => parseInt(v.trim(), 10))
    .filter((v) => Number.isFinite(v) && v > 0);
  return parsed.length ? parsed : [200, 100, 50, 25, 10];
};
const BURST_COUNT = Number.isFinite(parseInt(process.env.JIMU_TIMING_COUNT, 10))
  ? parseInt(process.env.JIMU_TIMING_COUNT, 10)
  : 30;
const TARGET = (process.env.JIMU_TARGET || '').toLowerCase();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const summarize = (vals = []) => {
  if (!vals.length) return null;
  const sorted = [...vals].sort((a, b) => a - b);
  const pick = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    count: sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg: +(sum / sorted.length).toFixed(2),
    p50: pick(0.5),
    p95: pick(0.95),
  };
};

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
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('Choose device (Enter=1): ', (answer) => {
      rl.close();
      const choice = parseInt(answer, 10);
      const picked =
        Number.isInteger(choice) && choice >= 1 && choice <= devices.length
          ? devices[choice - 1]
          : devices[0];
      resolve(picked);
    });
  });
};

const runBurst = async (jimu, { payload, responseCmd, label, gapMs, count }) => {
  const sentAt = [];
  const latencies = [];
  let received = 0;

  const onFrame = ({ meta }) => {
    if (!meta || meta.cmd !== responseCmd) return;
    received += 1;
    if (sentAt.length) {
      latencies.push(Date.now() - sentAt.shift());
    }
  };
  jimu.on('frame', onFrame);
  for (let i = 0; i < count; i += 1) {
    sentAt.push(Date.now());
    await jimu.client.send(payload);
    await sleep(gapMs);
  }
  await sleep(400);
  jimu.off('frame', onFrame);

  return {
    label,
    gapMs,
    sent: count,
    received,
    dropped: Math.max(0, count - received),
    latency: summarize(latencies),
  };
};

const main = async () => {
  const jimu = new Jimu({ pingIntervalMs: 0, batteryIntervalMs: 0 });
  try {
    const device = await selectDevice();
    if (!device) return;
    console.log(`Connecting to ${device.name} (${device.id})...`);
    await jimu.connect(device.peripheral || device.id);
    console.log('Connected. Detected modules:', jimu.getStatus());

    const intervals = defaultIntervals();
    const tests = [
      { label: 'IR_1', payload: [0x7e, 0x01, 0x01, 0x01], responseCmd: 0x7e },
      { label: 'US_1', payload: [0x7e, 0x01, 0x06, 0x01], responseCmd: 0x7e },
      { label: 'SERVO_POS_1', payload: [0x0b, 0x01, 0x00], responseCmd: 0x0b },
    ];

    for (const t of tests) {
      console.log(`\n== ${t.label} ==`);
      for (const gap of intervals) {
        const res = await runBurst(jimu, {
          ...t,
          gapMs: gap,
          count: BURST_COUNT,
        });
        const lat = res.latency
          ? `lat ms min=${res.latency.min} p50=${res.latency.p50} p95=${res.latency.p95} max=${res.latency.max}`
          : 'lat=none';
        console.log(
          ` gap=${gap}ms sent=${res.sent} recv=${res.received} drop=${res.dropped} ${lat}`,
        );
      }
    }
    console.log('\nDone.');
  } catch (e) {
    console.error('Probe failed:', e.message);
  } finally {
    try {
      await jimu.disconnect();
    } catch (_) {
      // ignore
    }
  }
};

main();
