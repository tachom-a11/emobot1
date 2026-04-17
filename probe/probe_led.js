// Interactive probe for JIMU eyes/LEDs using commands 0x79 (color/mask) and 0x78 (animation).
// Controls: r = default white, 1-9 = variants (colors/masks/animation), q = quit. All notifications printed with counter.
import noble from '@abandonware/noble';

const TARGET_NAME_SUBSTR = 'jimu';
const CUSTOM_PREFIX = '49535343';

// 0x79 payload: [0x79, 0x04, eyesMask(1/2/3), time, 0x01, 0xFF, R, G, B]
// 0x78 payload: [0x78, 0x04, eyesMask, animationId, 0x00, repetitions, R, G, B]
const DEFAULT_COLOR = [0x79, 0x04, 0x03, 0x0A, 0x01, 0xFF, 0xFF, 0xFF, 0xFF]; // both eyes white
const VARIANTS = {
  '1': [0x79, 0x04, 0x03, 0x0A, 0x01, 0xFF, 0xFF, 0x00, 0x00], // red both
  '2': [0x79, 0x04, 0x03, 0x0A, 0x01, 0xFF, 0x00, 0xFF, 0x00], // green both
  '3': [0x79, 0x04, 0x03, 0x0A, 0x01, 0xFF, 0x00, 0x00, 0xFF], // blue both
  '4': [0x79, 0x04, 0x01, 0x0A, 0x01, 0xFF, 0xFF, 0xA5, 0x00], // left eye amber
  '5': [0x79, 0x04, 0x02, 0x0A, 0x01, 0xFF, 0x80, 0x00, 0x80], // right eye purple
  '6': [0x79, 0x04, 0x03, 0x0A, 0x01, 0x0F, 0xFF, 0x00, 0x00], // mask test: limited lights
  '7': [0x79, 0x04, 0x03, 0xFF, 0x05, 0x11, 0xFF, 0xF0, 0x00, 0x0A, 0xFF, 0x80, 0x00], // multi-color mask sequence
  '8': [0x78, 0x04, 0x03, 0x02, 0x00, 0x01, 0x40, 0x40, 0xFF], // animation id 2, blue-ish
  '9': [0x78, 0x04, 0x03, 0x01, 0x00, 0x03, 0xFF, 0x80, 0x00], // animation id 1, amber, repeat 3
};

let notifyCounter = 1;

const buildMsg = (payload) => {
  const header = [0xfb, 0xbf, payload.length + 4];
  const message = header.concat(payload);
  message.push(message.slice(2).reduce((p, c) => p + c));
  message.push(0xed);
  return Buffer.from(message);
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

  for (const nc of notifyChars) {
    try {
      await nc.subscribeAsync();
      console.log('Subscribed notify', nc.uuid);
      nc.on('data', (d) => {
        const label = `NOTIFY ${String(notifyCounter).padStart(4, '0')}`;
        notifyCounter += 1;
        console.log(label, `char=${nc.uuid}`, d);
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

  const sendVariant = async (key) => {
    const payload = key === 'r' ? DEFAULT_COLOR : VARIANTS[key];
    if (!payload) return;
    notifyCounter = 1;
    await send(payload, `variant_${key}`);
  };

  console.log('Controls: r=default white, 1-9 variants (colors/masks/animations), q=quit. All notifications are printed.');

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', async (chunk) => {
    const key = chunk.toString().trim();
    const bytes = Array.from(chunk);
    if (key === 'q' || bytes[0] === 3) {
      console.log('Exiting...');
      process.stdin.setRawMode(false);
      for (const nc of notifyChars) {
        try { await nc.unsubscribeAsync(); } catch (_) {}
      }
      try { await p.disconnectAsync(); } catch (_) {}
      process.exit(0);
    } else if (key === 'r') {
      await sendVariant('r');
    } else if (VARIANTS[key]) {
      await sendVariant(key);
    } else {
      console.log('Unknown key', key, bytes);
    }
  });
});
