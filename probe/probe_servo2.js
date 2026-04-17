// Multi-servo probe: select up to 3 servos (IDs 1-10) and move them together with arrow up/down (+/- 10) or 'c' for center.
// Requires: npm install @abandonware/noble
import noble from '@abandonware/noble';

const TARGET_NAME_SUBSTR = 'jimu';
const CUSTOM_PREFIX = '49535343';
const STEP = 10;
const MIN_POS = 0;
const MAX_POS = 252;
const CENTER_POS = 120;
const SPEED = 30;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const buildMsg = (payload) => {
  const header = [0xfb, 0xbf, payload.length + 4];
  const message = header.concat(payload);
  message.push(message.slice(2).reduce((p, c) => p + c));
  message.push(0xed);
  return Buffer.from(message);
};

const buildSelector = (ids) => {
  let b1 = 0, b2 = 0, b3 = 0, b4 = 0; // sel8_1, sel16_9, sel24_17, sel32_25
  ids.forEach((id) => {
    if (id >= 1 && id <= 8) b1 |= 1 << (id - 1);
    else if (id >= 9 && id <= 16) b2 |= 1 << (id - 9);
    else if (id >= 17 && id <= 24) b3 |= 1 << (id - 17);
    else if (id >= 25 && id <= 32) b4 |= 1 << (id - 25);
  });
  return [b4, b3, b2, b1];
};

const makeSetPos = (selectedIds, targetPos, speed = SPEED) => {
  if (!selectedIds.length) return null;
  const sorted = [...selectedIds].sort((a, b) => a - b).slice(0, 3);
  const [sel32_25, sel24_17, sel16_9, sel8_1] = buildSelector(sorted);
  // Fill all three slots with the same position (mirrors working probe behavior).
  const posBytes = [targetPos, targetPos, targetPos];
  return [0x09, sel32_25, sel24_17, sel16_9, sel8_1, posBytes[0], posBytes[1], posBytes[2], speed, 1, 121];
};

noble.on('stateChange', async (state) => {
  console.log('Adapter state:', state);
  if (state === 'poweredOn') {
    console.log('Scanning for devices...');
    await noble.startScanningAsync([], false);
  } else {
    await noble.stopScanningAsync();
  }
});

noble.on('discover', async (p) => {
  const name = p.advertisement?.localName || '';
  console.log('Found device', `"${name}"`, p.id);
  if (!name || !name.toLowerCase().includes(TARGET_NAME_SUBSTR)) return;
  console.log('Matched target', name, p.id);

  await noble.stopScanningAsync();
  await p.connectAsync();

  const { characteristics, services } = await p.discoverAllServicesAndCharacteristicsAsync();
  console.log('Services:', services.map(s => s.uuid));
  console.log('Characteristics:', characteristics.map((c, idx) => `${idx}:${c.uuid}:${c.properties.join(',')};svc:${c._serviceUuid || c._serviceId || 'unknown'}`));

  const targetService = services.find(s => s.uuid.replace(/-/g, '').startsWith(CUSTOM_PREFIX))?.uuid;
  const byService = (svc) => characteristics.filter(c => (c._serviceUuid || '').replace(/-/g, '') === svc.replace(/-/g, ''));
  const targetChars = targetService ? byService(targetService) : characteristics;

  const notifyChars = (targetChars.length ? targetChars : characteristics).filter(c => c.properties.includes('notify'));
  const preferredWrites = [
    '49535343884143f4a8d4ecbe34729bb3',
    '49535343aca3481c91ecd85e28a60318',
  ];
  const writeChars = [];
  for (const u of preferredWrites) {
    const c = characteristics.find(x => x.uuid === u);
    if (c && (c.properties.includes('write') || c.properties.includes('writeWithoutResponse'))) writeChars.push(c);
  }
  for (const c of targetChars) {
    if (!writeChars.includes(c) && (c.properties.includes('write') || c.properties.includes('writeWithoutResponse'))) writeChars.push(c);
  }
  for (const c of characteristics) {
    if (!writeChars.includes(c) && (c.properties.includes('write') || c.properties.includes('writeWithoutResponse'))) writeChars.push(c);
  }

  if (!notifyChars.length || !writeChars.length) {
    console.error('Could not find write/notify characteristics');
    process.exit(1);
  }

  const send = async (payload, label) => {
    const msg = buildMsg(payload);
    for (const wc of writeChars) {
      const withoutResponse = wc.properties.includes('writeWithoutResponse');
      console.log('SEND', label, 'via', wc.uuid, msg.toString('hex'), `wwr=${withoutResponse}`);
      try {
        await wc.writeAsync(msg, withoutResponse);
        return true;
      } catch (e) {
        console.warn('Write failed', wc.uuid, e.message);
      }
    }
    return false;
  };

  let current = CENTER_POS;
  let selected = [];
  const updateSelection = (id) => {
    if (selected.includes(id)) {
      selected = selected.filter(x => x !== id);
    } else {
      selected.push(id);
      if (selected.length > 3) selected = selected.slice(selected.length - 3); // keep last 3 selections
    }
    console.log('Selected servos:', selected.join(', ') || 'none');
  };

  const moveSelected = async (delta) => {
    if (!selected.length) {
      console.log('No servos selected.');
      return;
    }
    current = clamp(current + delta, MIN_POS, MAX_POS);
    const payload = makeSetPos(selected, current, SPEED);
    if (payload) {
      await send(payload, `set_${current}_sel_${selected.join('_')}`);
    }
  };

  console.log('Controls: 1-9,0 toggle servo IDs (0=10), arrows up/down or +/- to move (+/-10), c=center, q=quit');
  console.log(`Starting at ~center (${CENTER_POS}).`);

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', async (chunk) => {
    const key = chunk.toString();
    const bytes = Array.from(chunk);
    let handled = false;
    if (key.trim() === 'q' || bytes[0] === 3) {
      console.log('Exiting...');
      process.stdin.setRawMode(false);
      for (const nc of notifyChars) {
        try { await nc.unsubscribeAsync(); } catch (_) {}
      }
      try { await p.disconnectAsync(); } catch (_) {}
      process.exit(0);
    } else if (key >= '1' && key <= '9') {
      updateSelection(parseInt(key, 10));
      handled = true;
    } else if (key === '0') {
      updateSelection(10);
      handled = true;
    } else if (key === '+' || key === '=') {
      await moveSelected(STEP);
      handled = true;
    } else if (key === '-' || key === '_') {
      await moveSelected(-STEP);
      handled = true;
    } else if (bytes.length === 3 && bytes[0] === 0x1b && bytes[1] === 0x5b && bytes[2] === 0x41) { // arrow up
      await moveSelected(STEP);
      handled = true;
    } else if (bytes.length === 3 && bytes[0] === 0x1b && bytes[1] === 0x5b && bytes[2] === 0x42) { // arrow down
      await moveSelected(-STEP);
      handled = true;
    } else if (key.trim() === 'c') {
      current = CENTER_POS;
      await moveSelected(0);
      handled = true;
    }
    if (!handled) {
      console.log('Unknown key', key.trim(), bytes);
    }
  });
});
