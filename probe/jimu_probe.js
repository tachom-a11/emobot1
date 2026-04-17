#!/usr/bin/env node
import readline from 'readline';
import { JimuBleClient } from '../jimu/jimu_ble.js';

const info = console.log;
const warn = console.warn;
const error = console.error;

const client = new JimuBleClient();

const state = {
  cmd: 1,
  params: [1, 1, 1],
  paramCount: 3,
};

const clampByte = (v) => ((v % 256) + 256) % 256;
const toHex = (v) => `0x${clampByte(v).toString(16).padStart(2, '0')}`;

const renderState = () => {
  const payload = [state.cmd, ...state.params.slice(0, state.paramCount)];
  process.stdout.write(`\rCurrent payload: cmd=${toHex(state.cmd)} [${payload.join(', ')}] `.padEnd(80, ' '));
};

const renderHelp = () => {
  info('\nControls:');
  info('  Up/Down: cmd +/- 1 (wrap 0..255)');
  info('  Left/Right: change param count (0..10)');
  info('  1..0: increment p1..p10; q,w,e,r,t,y,u,i,o,p: decrement p1..p10');
  info('  Enter: send command');
  info('  z: disconnect and exit');
  renderState();
};

const selectDevice = async () => {
  info('Scanning for JIMU devices (5s)...');
  const devices = await JimuBleClient.scan({ timeoutMs: 5000 });
  if (!devices.length) {
    info('No JIMU modules detected. Make sure the brick is on, advertising, and close the official app if it is connected.');
    return null;
  }

  devices.forEach((d, idx) => info(`${idx + 1}. ${d.name || 'Unknown'} (${d.id})`));
  info('Choose device: number (1..n) or Enter for first');

  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('Selection: ', (answer) => {
      rl.close();
      const choice = parseInt(answer, 10);
      const picked = Number.isInteger(choice) && choice >= 1 && choice <= devices.length ? devices[choice - 1] : devices[0];
      resolve(picked);
    });
  });
};

const attachInputHandlers = () => {
  if (!process.stdin.isTTY) {
    warn('Interactive controls require a TTY (stdin is not a terminal).');
    return;
  }
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', async (chunk) => {
    const str = chunk.toString('utf8');
    const bytes = Array.from(chunk);

    // Arrow keys: \u001b[A etc
    if (bytes.length === 3 && bytes[0] === 0x1b && bytes[1] === 0x5b) {
      const dir = bytes[2];
      if (dir === 0x41) state.cmd = clampByte(state.cmd + 1); // Up
      if (dir === 0x42) state.cmd = clampByte(state.cmd - 1); // Down
      if (dir === 0x43) state.paramCount = Math.min(10, state.paramCount + 1); // Right
      if (dir === 0x44) state.paramCount = Math.max(0, state.paramCount - 1); // Left
      while (state.params.length < state.paramCount) state.params.push(0);
      renderState();
      return;
    }

    if (str === '\r') {
      const payload = [state.cmd, ...state.params.slice(0, state.paramCount)];
      try {
        await client.send(payload);
        info(`\n=> Sent cmd=${toHex(state.cmd)} [${payload.join(', ')}]`);
      } catch (e) {
        error(`\nSend failed: ${e.message}`);
      }
      renderState();
      return;
    }

    if (str === 'z') {
      info('\nDisconnecting...');
      await client.disconnect();
      process.exit(0);
    }

    const incKeys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
    const decKeys = ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'];

    const incIdx = incKeys.indexOf(str);
    if (incIdx !== -1) {
      const idx = incIdx === 9 ? 9 : incIdx; // '0' maps to p10
      if (idx < state.paramCount) {
        state.params[idx] = clampByte(state.params[idx] + 1);
        renderState();
      }
      return;
    }

    const decIdx = decKeys.indexOf(str);
    if (decIdx !== -1) {
      if (decIdx < state.paramCount) {
        state.params[decIdx] = clampByte(state.params[decIdx] - 1);
        renderState();
      }
      return;
    }
  });
};

const main = async () => {
  try {
    const device = await selectDevice();
    if (!device) return;
    info(`Connecting to ${device.name} (${device.id})...`);
    await client.connect(device.peripheral);
    info('Connected. Subscribed to notifications.');
  } catch (e) {
    error(e.message);
    process.exit(1);
  }

  client.on('frame', ({ payload }) => {
    const cmdHex = payload.length ? toHex(payload[0]) : 'n/a';
    info(`\n<= cmd=${cmdHex} ${payload.toString('hex')} (${Array.from(payload).join(', ')})`);
    renderState();
  });
  client.on('connect', (details) => {
    info(`Connected: ${details.name} (${details.id}) | write chars: ${details.writeCount}, notify chars: ${details.notifyCount}`);
  });
  client.on('frameError', (err) => {
    warn(`\nFrame error: ${err.message}`);
    renderState();
  });
  client.on('disconnect', () => {
    warn('\nDisconnected from device.');
    process.exit(1);
  });

  renderHelp();
  attachInputHandlers();
};

main();
