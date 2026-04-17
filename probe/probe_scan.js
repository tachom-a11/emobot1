// Brute-force scan of sensor commands [0x7E, a, b, c] over 0x00-0xFF for a/b/c.
// Logs any notification that is not an invalid-command response or that contains non-zero data in the 10th byte for 0x7E responses.
// Controls: Enter to start scan, q to quit early. Be patient; 256^3 commands is large—adjust bounds if needed.
import noble from '@abandonware/noble';

const TARGET_NAME_SUBSTR = 'jimu';
const CUSTOM_PREFIX = '49535343';
const INVALID_RESP_HEX = 'fbbf08720100007bed'; // fb bf 08 72 01 00 00 7b ed

const buildMsg = (payload) => {
  const header = [0xfb, 0xbf, payload.length + 4];
  const message = header.concat(payload);
  message.push(message.slice(2).reduce((p, c) => p + c));
  message.push(0xed);
  return Buffer.from(message);
};

let notifyCounter = 1;
const findings = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GREEN = '🟢';
let currentCmdHex = '';

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

  let notifyChars = [];
  let writeChars = [];

  const setup = async () => {
    notifyChars = [];
    writeChars = [];
    const { characteristics, services } = await p.discoverAllServicesAndCharacteristicsAsync();
    console.log('Services:', services.map(s => s.uuid));
    console.log('Characteristics:', characteristics.map((c, idx) => `${idx}:${c.uuid}:${c.properties.join(',')};svc:${c._serviceUuid || c._serviceId || 'unknown'}`));

    const targetService = services.find(s => s.uuid.replace(/-/g, '').startsWith(CUSTOM_PREFIX))?.uuid;
    const byService = (svc) => characteristics.filter(c => (c._serviceUuid || '').replace(/-/g, '') === svc.replace(/-/g, ''));
    const targetChars = targetService ? byService(targetService) : characteristics;

    notifyChars = (targetChars.length ? targetChars : characteristics).filter(c => c.properties.includes('notify'));
    const preferredWrites = [
      '49535343884143f4a8d4ecbe34729bb3',
      '49535343aca3481c91ecd85e28a60318',
    ];
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
          const hex = d.toString('hex');
          const label = `NOTIFY ${String(notifyCounter).padStart(4, '0')}`;
          notifyCounter += 1;
          if (hex === INVALID_RESP_HEX) return;
          const ackPrefix = currentCmdHex ? `fbbf06${currentCmdHex}00` : '';
          if ((ackPrefix && hex.startsWith(ackPrefix)) || hex.startsWith('fbbf06')) {
            console.log(label, `char=${nc.uuid}\n${d}`);
            return;
          }
          if (d.length >= 10 && d[3] === 0x7e) {
            const sensorVal = d[9];
            if (sensorVal !== 0) {
              findings.push({ hex, sensorVal });
              console.log(`${GREEN} ${label} char=${nc.uuid} hex=${hex}\n${d}`);
              return;
            }
          }
          console.log(`${GREEN} NOTIFY ${String(notifyCounter - 1).padStart(4, '0')} char=${nc.uuid} hex=${hex}\n${d}`);
        });
      } catch (e) {
        console.warn('Subscribe failed', nc.uuid, e.message);
      }
    }
  };

  const ensureConnected = async () => {
    if (p.state === 'connected') return true;
    console.log('DEVICE DISCONNECTED - reconnecting...');
    try {
      await p.connectAsync();
      await setup();
      console.log('Reconnected.');
      return true;
    } catch (e) {
      console.error('Reconnect failed:', e.message);
      return false;
    }
  };

  p.on('disconnect', ensureConnected);
  await ensureConnected();

  const send = async (payload, label) => {
    const msg = buildMsg(payload);
    currentCmdHex = payload[0].toString(16).padStart(2, '0');
    if (!(await ensureConnected())) return false;
    for (const wc of writeChars) {
      const withoutResponse = wc.properties.includes('writeWithoutResponse');
      console.log('SEND', label, 'via', wc.uuid, msg.toString('hex'), `wwr=${withoutResponse}`);
      try {
        await wc.writeAsync(msg, withoutResponse);
        return true;
      } catch (e) {
        console.warn('Write failed', wc.uuid, e.message);
        if ((e.message || '').toLowerCase().includes('not connected')) {
          if (await ensureConnected()) {
            try {
              await wc.writeAsync(msg, withoutResponse);
              return true;
            } catch (err) {
              console.warn('Retry after reconnect failed', err.message);
            }
          }
        }
      }
    }
    return false;
  };

  const scan = async () => {
    console.log('Starting scan over a=0x00..0x0F, b=0x00..0x0F, c=0x00..0x0F (can extend ranges if needed)...');
    for (let a = 0; a <= 0x0f; a++) {
      for (let b = 0; b <= 0x0f; b++) {
        for (let c = 0; c <= 0x0f; c++) {
          const payload = [0x7e, a, b, c].map((v, idx) => (idx === 0 ? v : 0x01));
          await send(payload, `read_${a.toString(16)}_${b.toString(16)}_${c.toString(16)}`);
          await sleep(20);
        }
      }
    }
    console.log('Scan complete. Findings with non-zero sensor byte:', findings);
  };

  console.log('Controls: Enter to start scan (a,b,c in 0x00..0x0F), q=quit. All notifications will be printed; non-zero sensor values will be reported.');

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
      console.log('Findings:', findings);
      process.exit(0);
    } else {
      notifyCounter = 1;
      findings.length = 0;
      await scan();
    }
  });
});
