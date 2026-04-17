// Minimal JIMU probe: scan, connect, send sensor/position reads, and log parsed notifications.
// Requires: npm install @abandonware/noble
import noble from '@abandonware/noble';

const TARGET_NAME_SUBSTR = 'jimu'; // case-insensitive match on advertised name
const CUSTOM_PREFIX = '49535343'; // vendor service/char UUID prefix seen on device

const buildMsg = (payload) => {
  const header = [0xfb, 0xbf, payload.length + 4];
  const message = header.concat(payload);
  message.push(message.slice(2).reduce((p, c) => p + c));
  message.push(0xed);
  return Buffer.from(message);
};

// Known read commands from node-jimu
const CMD_GET_SENSORS = [0x7e, 0x01, 0x01, 0x01];
const CMD_GET_POSITIONS = [0x0b, 0x00, 0x00];
// Set servo positions (3 slots) per node-jimu example: payload [0x09,0,0,0,28,s1,s2,s3,speed,1,121]
const makeSetPos = (s1, s2, s3, speed = 30) => [0x09, 0x00, 0x00, 0x00, 28, s1, s2, s3, speed, 1, 121];
// Rotate servo/motor (mode 0x01 single motor): [0x07, 0x01, motorId, direction(1|2), 0x01, velocity]
const makeRotate = (id, dir, vel) => [0x07, 0x01, id, dir, 0x01, vel];
// Stop both directions (mode 0x02 dual): [0x07, 0x02, dirLeft, dirRight, 0, 0, 0]
const STOP_ALL = [0x07, 0x02, 1, 2, 0x00, 0x00, 0x00];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const parsePacket = (buf) => {
  if (buf.length < 6) return null;
  const len = buf[2];
  const cmd = buf[3];
  const params = buf.slice(4, buf.length - 2); // strip checksum + 0xed
  return { len, cmd, params };
};

// From uKitExplore wired protocol: servo get-position returns -120..120; here we just decode raw little-endian field.
const decodePosition = (params) => {
  if (params.length < 5) return null;
  const id = params[0];
  const raw = params.slice(-2); // last two bytes shift with angle
  const value = raw[1] << 8 | raw[0]; // little-endian guess
  return { id, rawHex: Buffer.from(raw).toString('hex'), value };
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

  // Prefer the custom service with the 49535343 prefix
  const targetService = services.find(s => s.uuid.replace(/-/g, '').startsWith(CUSTOM_PREFIX))?.uuid;
  const byService = (svc) => characteristics.filter(c => (c._serviceUuid || '').replace(/-/g, '') === svc.replace(/-/g, ''));
  const targetChars = targetService ? byService(targetService) : characteristics;

  const notifyChars = (targetChars.length ? targetChars : characteristics).filter(c => c.properties.includes('notify'));
  const writeChar = targetChars.find(c => c.properties.includes('writeWithoutResponse')) ||
    targetChars.find(c => c.properties.includes('write')) ||
    characteristics.find(c => c.properties.includes('writeWithoutResponse')) ||
    characteristics.find(c => c.properties.includes('write'));

  if (!notifyChars.length || !writeChar) {
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
        if (lastByChar.get(nc.uuid) === hex) return; // drop unchanged
        lastByChar.set(nc.uuid, hex);
        const pkt = parsePacket(d);
        if (!pkt) {
          console.log('NOTIFY raw', hex, `char=${nc.uuid}`);
          return;
        }
        if (pkt.cmd === 0x0b && pkt.params.length >= 5) {
          const pos = decodePosition(pkt.params);
          console.log('POS', {
            char: nc.uuid,
            len: pkt.len,
            id: pos?.id,
            raw: pos?.rawHex,
            value: pos?.value,
            paramsDec: Array.from(pkt.params),
            hex,
          });
        } else if (pkt.cmd === 0x7e) {
          console.log('SENSOR', {
            char: nc.uuid,
            len: pkt.len,
            paramsHex: Buffer.from(pkt.params).toString('hex'),
            paramsDec: Array.from(pkt.params),
            hex,
          });
        } else {
          console.log('NOTIFY', {
            char: nc.uuid,
            len: pkt.len,
            cmd: pkt.cmd,
            paramsHex: Buffer.from(pkt.params).toString('hex'),
            paramsDec: Array.from(pkt.params),
            hex,
          });
        }
      });
    } catch (e) {
      console.warn('Subscribe failed', nc.uuid, e.message);
    }
  }

  const send = async (payload, label) => {
    const msg = buildMsg(payload);
    const withoutResponse = writeChar.properties.includes('writeWithoutResponse');
    console.log('SEND', label, 'via', writeChar.uuid, msg.toString('hex'), `wwr=${withoutResponse}`);
    try {
      await writeChar.writeAsync(msg, withoutResponse);
    } catch (e) {
      console.warn('Write failed', writeChar.uuid, e.message);
    }
  };

  const neutral = 205;
  console.log('Controls: 1=get_sensors  2=get_positions  3=servo3_min  4=servo3_max  5=rot dir1  6=rot dir2  7=stop+hold  8=rot dir1 slow  9=rot dir2 slow  0=hard_stop  h=hold_neutral  q=quit');
  const actions = {
    '1': () => send(CMD_GET_SENSORS, 'get_sensors'),
    '2': () => send(CMD_GET_POSITIONS, 'get_positions'),
    '3': () => send(makeSetPos(0, 0, 0,10), 'set_servo3_min'),
    '4': () => send(makeSetPos(120 , 0, 0,100), 'set_servo3_center'),
    '5': () => send(makeSetPos(128, 0, 0,200), 'set_servo3_128'),
    '6': () => send(makeSetPos(252, 0, 0,0), 'set_servo3_max'),
 //   '5': () => send(makeRotate(3, 1, 120), 'rotate_servo3_dir1'),
 //   '6': () => send(makeRotate(3, 2, 120), 'rotate_servo3_dir2'),
    '7': async () => {
      await send(STOP_ALL, 'stop_all_motors');
      await send(makeRotate(3, 1, 0), 'zero_dir1');
    },
    '8': () => send(makeRotate(3, 1, 30), 'rotate_servo3_dir1_slow'),
    '9': () => send(makeRotate(3, 2, 30), 'rotate_servo3_dir2_slow'),
    // Hard stop: send both directions with velocity 0 to the same ID
    '0': async () => {
      await send(makeRotate(3, 1, 0), 'hard_stop_dir1_zero');
      await send(makeRotate(3, 2, 0), 'hard_stop_dir2_zero');
  
    },
    'h': () => send(makeSetPos(neutral, neutral, neutral), 'hold_neutral'),
  };

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', async (chunk) => {
    const key = chunk.toString().trim();
    if (key === 'q' || chunk[0] === 3) { // q or Ctrl+C
      console.log('Exiting...');
      process.stdin.setRawMode(false);
      for (const nc of notifyChars) {
        try { await nc.unsubscribeAsync(); } catch (_) {}
      }
      try { await p.disconnectAsync(); } catch (_) {}
      process.exit(0);
    }
    const action = actions[key];
    if (action) {
      await action();
    } else {
      console.log('Unknown key', key);
    }
  });
});
