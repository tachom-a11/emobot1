// Generic command/payload scanner. Start with command byte 0x01; 'n' increments the command byte.
// 's' scans payload lengths 0..10 for the current command, sending [cmd, 1..len] as filler.
// All notifications are printed with a counter. Press 'q' to quit.
import noble from '@abandonware/noble';

const TARGET_NAME_SUBSTR = 'jimu';
const CUSTOM_PREFIX = '49535343';
const MAX_LEN = 10;
const DELAY_MS = 20;

let currentCmd = 0x01;
let notifyCounter = 1;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
        console.log(label, `char=${nc.uuid}`, d.toString('hex'), d);
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

  const scanCmd = async () => {
    console.log(`Scanning command 0x${currentCmd.toString(16)} with payload lengths 0..${MAX_LEN}...`);
    notifyCounter = 1;
    for (let len = 0; len <= MAX_LEN; len++) {
      const payload = [currentCmd];
      for (let i = 1; i <= len; i++) payload.push(i & 0xFF);
      await send(payload, `cmd_${currentCmd.toString(16)}_len_${len}`);
      await sleep(DELAY_MS);
    }
    console.log('Scan done for current command.');
  };

  console.log('Controls: s=scan current command, n=next command byte (+1), q=quit. Current command starts at 0x01.');

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
    } else if (key === 's') {
      await scanCmd();
    } else if (key === 'n') {
      currentCmd = (currentCmd + 1) & 0xFF;
      console.log(`Current command incremented to 0x${currentCmd.toString(16)}`);
    } else {
      console.log('Unknown key', key, bytes);
    }
  });
});
