// Servo probe for JIMU/UBTECH: interactively move servo ID 1 using + / - (or arrow keys) in 10-step increments.
// Requires: npm install @abandonware/noble
import noble from '@abandonware/noble';

const TARGET_NAME_SUBSTR = 'jimu'; // adjust to your advertised name
const CUSTOM_PREFIX = '49535343';  // UBTECH service prefix
const STEP = 10;
const MIN_POS = 0;
const MAX_POS = 252;
const CENTER_POS = 120;

const CMD_GET_POSITIONS = [0x0b, 0x00, 0x00];
const makeSetPos = (pos, speed = 30) =>
     [0x09, 0x00, 0x00, 0x00, 7, pos, pos, pos, speed, 1, 121];
//     [0x09, 0x00, 0x00, 0x00, 14, pos, pos, pos, speed, 1, 121];
//     [0x09, 0x00, 0x00, 0x00, 28, pos, 0x00, 0x00, speed, 1, 121];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// create message frame: start bytes, lenght , payload, crc, end
const buildMsg = (payload) => {
  const header = [0xfb, 0xbf, payload.length + 4];
  const message = header.concat(payload);
  message.push(message.slice(2).reduce((p, c) => p + c));
  message.push(0xed);
  return Buffer.from(message);
};

const parsePacket = (buf) => {
  if (buf.length < 5) return null;
  const len = buf[2];
  const cmd = buf[3];
  const params = buf.slice(4, buf.length - 2);
  return { len, cmd, params };
};

const decodePos = (params) => {
  if (params.length < 5) return null;
  const id = params[0];
  const raw = params.slice(-2);
  const value = raw[1] << 8 | raw[0];
  return { id, rawHex: Buffer.from(raw).toString('hex'), value, paramsDec: Array.from(params) };
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
        if (pkt.cmd === 0x0b) {
          const pos = decodePos(pkt.params);
          console.log('POS', { char: nc.uuid, id: pos?.id, value: pos?.value, raw: pos?.rawHex, paramsDec: pos?.paramsDec, hex });
        } else {
          console.log('NOTIFY', { char: nc.uuid, cmd: pkt.cmd, paramsDec: Array.from(pkt.params), hex });
        }
      });
    } catch (e) {
      console.warn('Subscribe failed', nc.uuid, e.message);
    }
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
  const setAndRequest = async (pos) => {
    current = clamp(pos, MIN_POS, MAX_POS);
    await send(makeSetPos(current), `set_${current}`);
  };

  console.log('Controls: +=up  -=down  arrows up/down also work  c=center  p=read positions  q=quit');
  console.log(`Starting at ~center (${CENTER_POS}); sending to slot s1}.`);

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
    } else if (key === '+' || key === '=') {
      await setAndRequest(current + STEP);
      handled = true;
    } else if (key === '-' || key === '_') {
      await setAndRequest(current - STEP);
      handled = true;
    } else if (bytes.length === 3 && bytes[0] === 0x1b && bytes[1] === 0x5b && bytes[2] === 0x41) { // arrow up
      await setAndRequest(current + STEP);
      handled = true;
    } else if (bytes.length === 3 && bytes[0] === 0x1b && bytes[1] === 0x5b && bytes[2] === 0x42) { // arrow down
      await setAndRequest(current - STEP);
      handled = true;
    } else if (key.trim() === 'c') {
      await setAndRequest(CENTER_POS);
      handled = true;
    } else if (key.trim() === 'p') {
      await send(CMD_GET_POSITIONS, 'get_positions');
      handled = true;
    }
    if (!handled) {
      console.log('Unknown key', key.trim(), bytes);
    }
  });
});
