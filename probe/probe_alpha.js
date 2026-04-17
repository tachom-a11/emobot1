// Alpha1-style BLE probe: test version (0x11) and battery (0x18) using official Alpha1 frame rules.
// Requires: npm install @abandonware/noble
import noble from '@abandonware/noble';

const TARGET_NAME_SUBSTR = 'jimu'; // match your brick name (case-insensitive)
const CUSTOM_PREFIX = '49535343'; // UBTECH BLE service prefix seen on devices

// Frame builder: try node-jimu/JIMU length rule (len = params.length + 4) and checksum = sum starting at len.
const buildAlphaMsg = (cmd, params = []) => {
  const len = params.length + 4; // len + cmd + params + checksum
  const body = [len, cmd, ...params];
  const checksum = body.reduce((sum, b) => (sum + b) & 0xFF, 0);
  const msg = [0xFB, 0xBF, ...body, checksum, 0xED];
  return Buffer.from(msg);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const parsePacket = (buf) => {
  if (buf.length < 5) return null;
  const len = buf[2];
  const cmd = buf[3];
  const params = buf.slice(4, buf.length - 2); // strip checksum + 0xED
  return { len, cmd, params };
};

const decodeBattery = (params) => {
  if (params.length < 4) return null;
  const mv = params[0] | (params[1] << 8);
  const chargeState = params[2]; // 0 no, 1 charging, 2 no battery (per PDF)
  const percent = params[3];
  return { mv, chargeState, percent };
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
  // Prefer known working write chars: wwr first (…8841…), then write+notify (…aca3…), then other writes
  const preferUUIDs = [
    '49535343884143f4a8d4ecbe34729bb3',
    '49535343aca3481c91ecd85e28a60318',
  ];
  const orderedWrites = [];
  for (const u of preferUUIDs) {
    const c = characteristics.find(x => x.uuid === u);
    if (c && (c.properties.includes('write') || c.properties.includes('writeWithoutResponse'))) orderedWrites.push(c);
  }
  for (const c of targetChars) {
    if (!orderedWrites.includes(c) && (c.properties.includes('write') || c.properties.includes('writeWithoutResponse'))) {
      orderedWrites.push(c);
    }
  }
  for (const c of characteristics) {
    if (!orderedWrites.includes(c) && (c.properties.includes('write') || c.properties.includes('writeWithoutResponse'))) {
      orderedWrites.push(c);
    }
  }
  const writeChars = orderedWrites;

  if (!notifyChars.length || !writeChars.length) {
    console.error('Could not find write/notify characteristics');
    process.exit(1);
  }

  const lastByChar = new Map();
  for (const nc of notifyChars) {
    try {
      await nc.subscribeAsync();
      console.log('Subscribed notify', nc.uuid);
      nc.on('data', (d) => {
        const hex = d.toString('hex');
        if (lastByChar.get(nc.uuid) === hex) return;
        lastByChar.set(nc.uuid, hex);
        const pkt = parsePacket(d);
        if (!pkt) {
          console.log('NOTIFY raw', hex, `char=${nc.uuid}`);
          return;
        }
        if (pkt.cmd === 0x18) {
          const bat = decodeBattery(pkt.params);
          console.log('BATTERY', { char: nc.uuid, len: pkt.len, paramsHex: Buffer.from(pkt.params).toString('hex'), parsed: bat, hex });
        } else if (pkt.cmd === 0x11) {
          console.log('VERSION', { char: nc.uuid, len: pkt.len, paramsHex: Buffer.from(pkt.params).toString('hex'), paramsDec: Array.from(pkt.params), hex });
        } else {
          console.log('NOTIFY', { char: nc.uuid, len: pkt.len, cmd: pkt.cmd, paramsHex: Buffer.from(pkt.params).toString('hex'), paramsDec: Array.from(pkt.params), hex });
        }
      });
    } catch (e) {
      console.warn('Subscribe failed', nc.uuid, e.message);
    }
  }

  const send = async (cmd, params, label) => {
    const msg = buildAlphaMsg(cmd, params);
    for (const wc of writeChars) {
      const withoutResponse = wc.properties.includes('writeWithoutResponse');
      console.log('SEND', label, 'via', wc.uuid, msg.toString('hex'), `wwr=${withoutResponse}`);
      try {
        await wc.writeAsync(msg, withoutResponse);
        return;
      } catch (e) {
        console.warn('Write failed', wc.uuid, e.message);
      }
    }
  };

  console.log('Controls: v=version(0x11)  b=battery(0x18)  h=handshake(0x01)  p=positions(0x24 single test)  q=quit');
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', async (chunk) => {
    const key = chunk.toString().trim();
    if (key === 'q' || chunk[0] === 3) {
      console.log('Exiting...');
      process.stdin.setRawMode(false);
      for (const nc of notifyChars) {
        try { await nc.unsubscribeAsync(); } catch (_) {}
      }
      try { await p.disconnectAsync(); } catch (_) {}
      process.exit(0);
    }
    try {
      if (key === 'v') {
        await send(0x11, [], 'read_version');
      } else if (key === 'b') {
        await send(0x18, [], 'read_battery');
      } else if (key === 'h') {
        await send(0x01, [0x00], 'handshake');
      } else if (key === 'p') {
        // Alpha1 read single servo angle (off) is 0x24 with servo id; try id=1
        await send(0x24, [0x01], 'read_servo1_angle');
      } else {
        console.log('Unknown key', key);
      }
    } catch (e) {
      console.warn('Action failed', e);
    }
  });
});
