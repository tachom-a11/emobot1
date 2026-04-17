// Interactive probe for continuous rotation using command 0x07 (single motor/servo mode).
// Controls:
//   1/2/3/4 select motor/servo ID (active at a time)
//   Arrow up / + : faster (+10)
//   Arrow down / - : slower (-10)
//   Arrow left/right : toggle direction (1 or 2)
//   s : set velocity = 0
//   q : quit
// Shows all notifications (no dedupe).
import noble from '@abandonware/noble';

const TARGET_NAME_SUBSTR = 'jimu';
const CUSTOM_PREFIX = '49535343';
const STEP = 10;
const MIN_SPEED = 0;
const MAX_SPEED = 1000;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const buildMsg = (payload) => {
  const header = [0xfb, 0xbf, payload.length + 4];
  const message = header.concat(payload);
  message.push(message.slice(2).reduce((p, c) => p + c));
  message.push(0xed);
  return Buffer.from(message);
};

// Rotate single: [0x07, 0x01, motorId, direction(1|2), velocity(high byte), velocity(low byte)]
//const makeRotate = (id, dir, vel) => [0x07, 0x01, id, dir, (vel &0xFF00) >> 8, vel & 0x00FF];
const makeRotate = (id, dir, vel) => [0x07, 0x01, id, dir, (vel &0xFF00) >> 8, vel & 0x00FF ];
   
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

  for (const nc of notifyChars) {
    try {
      await nc.subscribeAsync();
      console.log('Subscribed notify', nc.uuid);
      nc.on('data', (d) => {
        console.log('NOTIFY', `char=${nc.uuid}`, d.toString('hex'), d);
      });
    } catch (e) {
      console.warn('Subscribe failed', nc.uuid, e.message);
    }
  }

  const sendRotate = async (id, dir, vel, label) => {
    const msg = buildMsg(makeRotate(id, dir, vel));
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

  let currentId = 1;
  let dir = 1;
  let vel = 0;

  const apply = async () => {
    await sendRotate(currentId, dir, vel, `rot_id${currentId}_dir${dir}_vel${vel}`);
  };

  console.log('Controls: 1-4 select motor/servo ID; arrows up/down or +/- speed +/-10; arrows left/right toggle direction; s stop (vel=0); q quit');
  console.log(`Start: id=${currentId}, dir=${dir}, vel=${vel}`);

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', async (chunk) => {
    const key = chunk.toString();
    const bytes = Array.from(chunk);
    if (key.trim() === 'q' || bytes[0] === 3) {
      console.log('Exiting...');
      process.stdin.setRawMode(false);
      for (const nc of notifyChars) {
        try { await nc.unsubscribeAsync(); } catch (_) {}
      }
      try { await p.disconnectAsync(); } catch (_) {}
      process.exit(0);
    }
    if (key >= '1' && key <= '4') {
      currentId = parseInt(key, 10);
      console.log(`Selected id=${currentId}`);
      await apply();
    } else if (key === 's') {
      vel = 0;
      console.log('Stop (vel=0)');
      await apply();
    } else if (key === '+' || key === '=') {
      vel = clamp(vel + STEP, MIN_SPEED, MAX_SPEED);
      await apply();
    } else if (key === '-' || key === '_') {
      vel = clamp(vel - STEP, MIN_SPEED, MAX_SPEED);
      await apply();
    } else if (bytes.length === 3 && bytes[0] === 0x1b && bytes[1] === 0x5b && bytes[2] === 0x41) { // arrow up
      vel = clamp(vel + STEP, MIN_SPEED, MAX_SPEED);
      await apply();
    } else if (bytes.length === 3 && bytes[0] === 0x1b && bytes[1] === 0x5b && bytes[2] === 0x42) { // arrow down
      vel = clamp(vel - STEP, MIN_SPEED, MAX_SPEED);
      await apply();
    } else if (bytes.length === 3 && bytes[0] === 0x1b && bytes[1] === 0x5b && bytes[2] === 0x43) { // arrow right
      dir = dir === 1 ? 2 : 1;
      console.log(`Direction toggled to ${dir}`);
      await apply();
    } else if (bytes.length === 3 && bytes[0] === 0x1b && bytes[1] === 0x5b && bytes[2] === 0x44) { // arrow left
      dir = dir === 1 ? 2 : 1;
      console.log(`Direction toggled to ${dir}`);
      await apply();
    } else {
      console.log('Unknown key', key.trim(), bytes);
    }
  });
});
