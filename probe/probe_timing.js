#!/usr/bin/env node
// Probe to lock down service/characteristic order and stress BLE timing.
import readline from 'readline';
import { Jimu } from '../jimu/jimu.js';
import { JimuBleClient } from '../jimu/jimu_ble.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const defaultIntervals = () => {
  const env = process.env.JIMU_TIMING_INTERVALS;
  if (!env) return [200, 100, 50, 25, 10, 5];
  const parsed = env
    .split(',')
    .map((v) => parseInt(v.trim(), 10))
    .filter((v) => Number.isFinite(v) && v > 0);
  return parsed.length ? parsed : [200, 100, 50, 25, 10, 5];
};
const BURST_COUNT = Number.isFinite(parseInt(process.env.JIMU_TIMING_COUNT, 10))
  ? parseInt(process.env.JIMU_TIMING_COUNT, 10)
  : 30;

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
  const preset = (process.env.JIMU_TARGET || '').toLowerCase();
  console.log('Scanning for JIMU devices (5s)...');
  const devices = await JimuBleClient.scan({ timeoutMs: 5000 });
  if (!devices.length) {
    console.log('No JIMU modules detected. Make sure the brick is on and advertising.');
    return null;
  }
  if (preset) {
    const match = devices.find(
      (d) => d.id.toLowerCase() === preset || d.name.toLowerCase().includes(preset),
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

const logLayout = (client) => {
  const layout = client.getLayout();
  if (!layout) {
    console.log('Layout data not available.');
    return;
  }
  const notifySet = new Set(layout.selectedNotifyUuids || []);
  const writeSet = new Set(layout.selectedWriteUuids || []);
  const targetSvc = (layout.targetServiceUuid || '').replace(/-/g, '');

  console.log('\nServices (discovery order):');
  layout.services.forEach((s) => {
    const tag = targetSvc && s.uuid.replace(/-/g, '') === targetSvc ? ' <- target' : '';
    console.log(`  [${s.index}] ${s.uuid}${tag}`);
  });

  console.log('\nCharacteristics (discovery order):');
  layout.characteristics.forEach((c) => {
    const tags = [];
    if (notifySet.has(c.uuid)) tags.push('notify');
    if (writeSet.has(c.uuid)) tags.push('write');
    if (targetSvc && c.serviceUuid === targetSvc) tags.push('target-svc');
    const tagText = tags.length ? ` tags=${tags.join(',')}` : '';
    console.log(`  [${c.index}] ${c.uuid} props=${(c.properties || []).join('/')} ${tagText}`);
  });
  console.log('\nNotify order:', (layout.selectedNotifyUuids || []).join(', ') || 'none');
  console.log('Write order:', (layout.selectedWriteUuids || []).join(', ') || 'none');
};

const runBurst = async (jimu, { payload, label, gapMs, count, responseCmd }) => {
  const response = responseCmd ?? payload[0];
  const sentAt = [];
  const latencies = [];
  const errors = [];
  let received = 0;

  const onFrame = ({ meta }) => {
    if (!meta || meta.cmd !== response) return;
    received += 1;
    if (sentAt.length) {
      latencies.push(Date.now() - sentAt.shift());
    }
  };
  const onError = (evt) => {
    if (evt?.cmd === response) errors.push(evt);
  };

  jimu.on('frame', onFrame);
  jimu.on('deviceError', onError);
  for (let i = 0; i < count; i += 1) {
    sentAt.push(Date.now());
    await jimu.client.send(payload);
    await sleep(gapMs);
  }
  await sleep(500); // drain notifications
  jimu.off('frame', onFrame);
  jimu.off('deviceError', onError);

  return {
    label,
    gapMs,
    sent: count,
    received,
    dropped: Math.max(0, count - received),
    latencyStats: summarize(latencies),
    errors,
  };
};

const main = async () => {
  const jimu = new Jimu({ pingIntervalMs: 0, batteryIntervalMs: 0 });
  const notifyGaps = [];
  let lastFrameTs = null;

  jimu.on('frame', () => {
    const now = Date.now();
    if (lastFrameTs) notifyGaps.push(now - lastFrameTs);
    lastFrameTs = now;
  });
  jimu.on('errorReport', (err) => {
    console.warn('Error report (0x05):', err);
  });

  try {
    const device = await selectDevice();
    if (!device) return;
    console.log(`Connecting to ${device.name} (${device.id})...`);
    await jimu.connect(device.peripheral || device.id);
    console.log('Connected.');
    logLayout(jimu.client);

    await jimu.refreshStatus();
    await jimu.queryErrors();

    const intervals = defaultIntervals();
    console.log(`\nRunning timing sweep (${BURST_COUNT} cmds each) with gaps: ${intervals.join(', ')} ms`);
    const results = [];
    for (const gap of intervals) {
      // Use battery query as a safe, short response for timing.
      // Response cmd matches request cmd (0x27).
      const res = await runBurst(jimu, {
        payload: [0x27, 0x00],
        label: `battery_gap_${gap}`,
        gapMs: gap,
        count: BURST_COUNT,
        responseCmd: 0x27,
      });
      results.push(res);
      const lat = res.latencyStats
        ? `lat(ms) min=${res.latencyStats.min} p50=${res.latencyStats.p50} p95=${res.latencyStats.p95} max=${res.latencyStats.max}`
        : 'lat=none';
      console.log(
        ` gap=${gap}ms sent=${res.sent} recv=${res.received} drop=${res.dropped} ${lat} errors=${res.errors.length}`,
      );
    }

    const notifyStats = summarize(notifyGaps);
    console.log('\nNotification spacing (all frames seen during run):', notifyStats || 'none captured');
    console.log('\nDone.');
  } catch (e) {
    console.error('Probe failed:', e.message);
  } finally {
    try {
      await sleep(200);
      await jimu.disconnect();
    } catch (_) {
      // ignore
    }
  }
};

main();
