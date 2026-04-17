import { EventEmitter } from 'node:events';
import { JimuBleClient } from './jimu_ble.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const hexKey = (bytes) => Buffer.from(bytes || []).toString('hex');

const maskBytesToIds32 = (bytes) => {
  const out = [];
  const b = Array.isArray(bytes) ? bytes : Array.from(bytes || []);
  for (let bi = 0; bi < Math.min(4, b.length); bi += 1) {
    const v = Number(b[bi] ?? 0) & 0xff;
    for (let bit = 0; bit < 8; bit += 1) {
      if (v & (1 << bit)) out.push(bi * 8 + bit + 1);
    }
  }
  return out;
};

const maskByteToIds8 = (mask) => {
  const out = [];
  const m = Number(mask ?? 0) & 0xff;
  for (let bit = 0; bit < 8; bit += 1) {
    if (m & (1 << bit)) out.push(bit + 1);
  }
  return out;
};
const clampByte = (v) => ((v % 256) + 256) % 256;
const clampServoDeg = (deg) => Math.max(-120, Math.min(120, Math.round(deg ?? 0)));
const servoDegToRaw = (deg) => clampByte(clampServoDeg(deg) + 120); // -120..120 => 0..240
const servoRawToDeg = (raw) => Math.max(-120, Math.min(120, (raw ?? 120) - 120));
const SENSOR_TYPE = {
  IR: 0x01,
  ULTRASONIC: 0x06,
};
const encodeMotorSpeed = (speed = 0) => {
  const clamped = Math.max(-150, Math.min(150, Math.round(speed)));
  const encoded = clamped < 0 ? 0x10000 + clamped : clamped;
  return { clamped, hi: (encoded >> 8) & 0xff, lo: encoded & 0xff };
};
const encodeMotorDuration = (ms = 6000) => {
  const capped = Math.max(0, Math.min(ms, 6000));
  const ticks = Math.round(capped / 100); // protocol uses 0.1s units, max ~6s
  return { ticks, hi: (ticks >> 8) & 0xff, lo: ticks & 0xff };
};
const rgbToHsv255 = (r, g, b) => {
  const rr = clampByte(r) / 255;
  const gg = clampByte(g) / 255;
  const bb = clampByte(b) / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === rr) h = ((gg - bb) / delta) % 6;
    else if (max === gg) h = (bb - rr) / delta + 2;
    else h = (rr - gg) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : delta / max;
  const v = max;
  return {
    h: clampByte(Math.round((h / 360) * 255)),
    s: clampByte(Math.round(s * 255)),
    v: clampByte(Math.round(v * 255)),
  };
};
const parseAckLike = (payload = []) => {
  if (!payload?.length || payload.length > 4) return null;
  const [cmd, status, maybeId, maybeDetail] = payload;
  if (typeof status !== 'number') return null;
  const ok = status === 0x00;
  return {
    cmd,
    status,
    ok,
    deviceId: typeof maybeId === 'number' ? maybeId : null,
    detail: typeof maybeDetail === 'number' ? maybeDetail : null,
    raw: Array.from(payload),
  };
};
const parseError05 = (payload = []) => {
  if (!payload?.length || payload[0] !== 0x05) return null;
  const type = payload[1] ?? 0x00;
  const maskBytes = payload.slice(2);
  return { type, maskBytes, raw: Array.from(payload) };
};

const parseSensors7e = (payload = []) => {
  if (!payload?.length || payload[0] !== 0x7e) return null;
  // Observed response structure:
  //   [0x7E, 0x01, 0x01, <count>, [type, 0x00, id, valueHi, valueLo] x count]
  // Value is a 16-bit BE integer; for Ultrasonic => value / 10 = cm (0 => out of range).
  const count = payload[3] ?? 0;
  const readings = [];
  for (let i = 0; i < count; i += 1) {
    const off = 4 + i * 5;
    if (off + 5 > payload.length) break;
    const type = payload[off];
    const id = payload[off + 2];
    const value = (payload[off + 3] << 8) | payload[off + 4];
    readings.push({
      type,
      id,
      value,
      raw: Array.from(payload.slice(off, off + 5)),
    });
  }
  return { count, readings, raw: Array.from(payload) };
};

const maskByteToIds = (byte = 0) => {
  const ids = [];
  for (let i = 0; i < 8; i += 1) if (byte & (1 << i)) ids.push(i + 1);
  return ids;
};

const maskBytesToIds = (bytes = []) => {
  // bytes ordered as [b12, b13, b14, b15] mapping bits [id32..id1]
  const ids = [];
  const len = bytes.length;
  bytes.forEach((b, idx) => {
    const offset = (len - idx - 1) * 8; // b15 -> +0, b12 -> +24
    maskByteToIds(b).forEach((id) => ids.push(id + offset));
  });
  return ids;
};

const idsToMaskBytes32 = (ids = []) => {
  const bytes = [0, 0, 0, 0]; // b12..b15
  ids.forEach((id) => {
    if (id < 1 || id > 32) return;
    const idx = 3 - Math.floor((id - 1) / 8);
    const bit = (id - 1) % 8;
    bytes[idx] |= 1 << bit;
  });
  return bytes;
};

const idsToMaskByte = (ids = []) => ids.reduce((m, id) => m | (1 << ((id - 1) % 8)), 0) & 0xff;

const parseStatus08 = (payload) => {
  if (!payload?.length || payload[0] !== 0x08) return null;
  const safe = (idx) => (idx < payload.length ? payload[idx] : 0);
  const servoBytes = [safe(12), safe(13), safe(14), safe(15)];
  const irByte = safe(29);
  const eyeByte = safe(50);
  const usByte = safe(64);
  const speakerByte = safe(78);
  const motorByte = safe(120);
  const text = Buffer.from(payload.slice(1, Math.min(payload.length, 12)))
    .toString('ascii')
    .replace(/\0+$/, '');
  return {
    text,
    servos: maskBytesToIds(servoBytes),
    ir: maskByteToIds(irByte),
    eyes: maskByteToIds(eyeByte),
    ultrasonic: maskByteToIds(usByte),
    speakers: maskByteToIds(speakerByte),
    motors: maskByteToIds(motorByte),
    masks: {
      servos: servoBytes,
      ir: irByte,
      eyes: eyeByte,
      ultrasonic: usByte,
      speakers: speakerByte,
      motors: motorByte,
    },
  };
};

export class Jimu extends EventEmitter {
  constructor({
    pingIntervalMs = 5000,
    batteryIntervalMs = 30000,
    nameSubstring,
    commandSpacingMs = 25,
  } = {}) {
    super();
    this.client = new JimuBleClient({ nameSubstring });
    this.state = {
      status08: null,
      connected: false,
      battery: null,
      lastErrorReport: null,
      lastCommandResult: null,
    };
    this.pingIntervalMs = pingIntervalMs;
    this.batteryIntervalMs = batteryIntervalMs;
    this.commandSpacingMs = commandSpacingMs;
    this._pingTimer = null;
    this._batteryTimer = null;
    this._sendQueue = Promise.resolve();
    this._lastSendAt = 0;
    this._sendQueuePending = 0; // commands waiting (not including current in-flight)
    this._sendQueueInFlight = false; // a command is currently being sent/awaited
    this._sendQueueCurrentWaitMs = 0; // enqueue->send delay for current command
    this._sendQueueGen = 0; // increment to drop pending queued commands
    this._sendQueueItemId = 0;
    this._sendQueueByExact = new Map(); // exactKey -> token
    this._sendQueueByGroup = new Map(); // groupKey -> token
    this.singleFlight = true;
    this.singleFlightTimeoutMs = 800;
    this._onFrame = this._onFrame.bind(this);
    this._onDisconnect = this._onDisconnect.bind(this);
    this._onFrameError = this._onFrameError.bind(this);
  }

  _emitSendQueueStats() {
    this.emit('sendQueue', this.getSendQueueStats());
  }

  getSendQueueStats() {
    return {
      pending: Math.max(0, Number(this._sendQueuePending) || 0),
      inFlight: Boolean(this._sendQueueInFlight),
      currentWaitMs: Math.max(0, Number(this._sendQueueCurrentWaitMs) || 0),
    };
  }

  flushSendQueue() {
    this._sendQueueGen += 1;
    this._sendQueuePending = 0;
    this._sendQueueCurrentWaitMs = 0;
    this._sendQueueByExact.clear();
    this._sendQueueByGroup.clear();
    this._emitSendQueueStats();
  }

  async connect(target) {
    // Avoid listener accumulation on reconnect attempts (e.g. when a connect fails mid-way).
    this.client.removeListener('frame', this._onFrame);
    this.client.removeListener('frameError', this._onFrameError);
    this.client.removeListener('disconnect', this._onDisconnect);
    this.client.on('frame', this._onFrame);
    this.client.on('frameError', this._onFrameError);
    this.client.on('disconnect', this._onDisconnect);

    try {
      await this.client.connect(target);
      this.state.connected = true;
      await this._boot();
      this._startMaintenance();
      return this.getInfo();
    } catch (e) {
      this.state.connected = false;
      this._stopMaintenance();
      this.client.removeListener('frame', this._onFrame);
      this.client.removeListener('frameError', this._onFrameError);
      this.client.removeListener('disconnect', this._onDisconnect);
      throw e;
    }
  }

  async disconnect() {
    this._stopMaintenance();
    this.state.connected = false;
    this._sendQueuePending = 0;
    this._sendQueueInFlight = false;
    this._sendQueueCurrentWaitMs = 0;
    this._emitSendQueueStats();
    this.client.removeListener('frame', this._onFrame);
    this.client.removeListener('frameError', this._onFrameError);
    this.client.removeListener('disconnect', this._onDisconnect);
    await this.client.disconnect();
  }

  _onDisconnect() {
    this._stopMaintenance();
    this.state.connected = false;
    this._sendQueuePending = 0;
    this._sendQueueInFlight = false;
    this._sendQueueCurrentWaitMs = 0;
    this._emitSendQueueStats();
    this.client.removeListener('frame', this._onFrame);
    this.client.removeListener('frameError', this._onFrameError);
    this.client.removeListener('disconnect', this._onDisconnect);
    this.emit('disconnect');
  }

  _onFrameError(err, ctx) {
    this.emit('transportError', { message: err?.message || String(err), ctx: ctx || null });
  }

  _onFrame({ payload, cmd, meta }) {
    const ack = parseAckLike(Array.from(payload));
    if (ack) {
      this.state.lastCommandResult = ack;
      this.emit('commandResult', { ...ack, meta });
      if (!ack.ok) {
        this.emit('deviceError', { ...ack, meta });
      }
    }
    const errorReport = parseError05(Array.from(payload));
    if (errorReport) {
      this.state.lastErrorReport = errorReport;
      this.emit('errorReport', { ...errorReport, meta });
    }
    if (meta?.cmd === 0x08) {
      this.state.status08 = parseStatus08(Array.from(payload));
      this.emit('status', this.state.status08);
    }
    if (meta?.cmd === 0x27 && payload.length >= 5) {
      const charging = payload[1] === 1;
      const volts = (payload[3] * 256 + payload[4]) / 2500;
      this.state.battery = { charging, volts, raw: [payload[3], payload[4]] };
      this.emit('battery', this.state.battery);
    }
    if (meta?.cmd === 0x7e) {
      const parsed = parseSensors7e(Array.from(payload));
      this.emit('sensor', { parsed, payload, meta });
    }
    if (meta?.cmd === 0x03) {
      this.emit('ping', payload);
    }
    if (meta?.cmd === 0x0b && payload?.length >= 3) {
      const id = payload[1] ?? 0;
      const raw = payload[payload.length - 1] ?? 120;
      this.emit('servoPosition', { id, raw, deg: servoRawToDeg(raw), meta });
    }
    this.emit('frame', { payload, cmd, meta });
  }

  async _boot() {
    // Minimal tested boot: info -> probe -> status -> enable -> battery
    const seq = [
      [0x36, 0x00],
      [0x01, 0x00],
    ];
    for (const p of seq) {
      await this._send(p);
      await sleep(150);
    }
    // Some firmware variants are slower to emit the first status frame after connect.
    // Use a longer timeout for the initial status request.
    await this.refreshStatus({ timeoutMs: 4000 });
    await this.enableDetected();
    await this.requestBattery();
  }

  _startMaintenance() {
    this._stopMaintenance();
    if (this.pingIntervalMs > 0) {
      this._pingTimer = setInterval(() => this._send([0x03, 0x00]), this.pingIntervalMs);
    }
    if (this.batteryIntervalMs > 0) {
      this._batteryTimer = setInterval(() => this.requestBattery(), this.batteryIntervalMs);
    }
  }

  _stopMaintenance() {
    if (this._pingTimer) clearInterval(this._pingTimer);
    if (this._batteryTimer) clearInterval(this._batteryTimer);
    this._pingTimer = null;
    this._batteryTimer = null;
  }

  _waitForFrameCmd(cmd, { timeoutMs = 1200 } = {}) {
    return new Promise((resolve, reject) => {
      const onFrame = (evt) => {
        if (evt?.meta?.cmd !== cmd) return;
        cleanup();
        resolve(evt);
      };
      const onDisconnect = () => {
        cleanup();
        reject(new Error('Disconnected while waiting for response'));
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out waiting for response cmd=0x${cmd.toString(16)}`));
      }, Math.max(100, timeoutMs ?? 1200));

      const cleanup = () => {
        clearTimeout(timer);
        this.removeListener('frame', onFrame);
        this.removeListener('disconnect', onDisconnect);
      };

      this.on('frame', onFrame);
      this.on('disconnect', onDisconnect);
    });
  }

  _waitForStatus(timeoutMs = 1200) {
    return new Promise((resolve, reject) => {
      const onStatus = (s) => {
        cleanup();
        resolve(s);
      };
      const onDisconnect = () => {
        cleanup();
        reject(new Error('Disconnected while waiting for status'));
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('Timed out waiting for status'));
      }, Math.max(100, timeoutMs ?? 1200));

      const cleanup = () => {
        clearTimeout(timer);
        this.removeListener('status', onStatus);
        this.removeListener('disconnect', onDisconnect);
      };

      this.on('status', onStatus);
      this.on('disconnect', onDisconnect);
    });
  }

  _waitForBattery(timeoutMs = 1200) {
    return new Promise((resolve, reject) => {
      const onBattery = (b) => {
        cleanup();
        resolve(b);
      };
      const onDisconnect = () => {
        cleanup();
        reject(new Error('Disconnected while waiting for battery'));
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('Timed out waiting for battery'));
      }, Math.max(100, timeoutMs ?? 1200));

      const cleanup = () => {
        clearTimeout(timer);
        this.removeListener('battery', onBattery);
        this.removeListener('disconnect', onDisconnect);
      };

      this.on('battery', onBattery);
      this.on('disconnect', onDisconnect);
    });
  }

  async _send(payload, { blockUntil = null, enqueueOnly = false } = {}) {
    const enqueuedAt = Date.now();
    const gen = this._sendQueueGen;

    const p = Array.isArray(payload) ? payload : Array.from(payload || []);
    const cmd = p[0];

    const makeDedupe = () => {
      // Only coalesce actuator commands (don't touch sensor/status requests).
      if (cmd === 0x09) {
        const ids = maskBytesToIds32(p.slice(1, 5));
        return { exactKey: `09:${hexKey(p)}`, groupKeys: ids.map((id) => `servo:${id}`) };
      }
      if (cmd === 0x07) {
        const n = Number(p[1] ?? 0) & 0xff;
        const ids = p.slice(2, 2 + n).map((x) => Number(x ?? 0) & 0xff).filter((x) => x > 0);
        return { exactKey: `07:${hexKey(p)}`, groupKeys: ids.map((id) => `servo:${id}`) };
      }
      if (cmd === 0x90) {
        const idOrMask = Number(p[2] ?? 0) & 0xff;
        const isDual = p.length > 7;
        const ids = isDual ? maskByteToIds8(idOrMask) : [idOrMask];
        return { exactKey: `90:${hexKey(p)}`, groupKeys: ids.filter((x) => x > 0).map((id) => `motor:${id}`) };
      }
      if (cmd === 0x79) {
        const sub = Number(p[1] ?? 0) & 0xff;
        if (sub === 0x06) {
          const id = Number(p[2] ?? 0) & 0xff;
          return { exactKey: `79:06:${hexKey(p)}`, groupKeys: id ? [`usled:${id}`] : [] };
        }
        if (sub === 0x04) {
          const eyesMask = Number(p[2] ?? 0) & 0xff;
          const ids = maskByteToIds8(eyesMask);
          return { exactKey: `79:04:${hexKey(p)}`, groupKeys: ids.map((id) => `eye:${id}`) };
        }
      }
      if (cmd === 0x78) {
        const eyesMask = Number(p[2] ?? 0) & 0xff;
        const ids = maskByteToIds8(eyesMask);
        return { exactKey: `78:${hexKey(p)}`, groupKeys: ids.map((id) => `eye:${id}`) };
      }
      return null;
    };

    const dedupe = makeDedupe();
    const exactKey = dedupe?.exactKey || null;
    const groupKeys = Array.isArray(dedupe?.groupKeys) ? dedupe.groupKeys.filter(Boolean) : [];

    const cleanupDedupe = (token) => {
      if (!token) return;
      if (token.exactKey && this._sendQueueByExact.get(token.exactKey) === token) this._sendQueueByExact.delete(token.exactKey);
      for (const gk of token.groupKeys || []) {
        if (this._sendQueueByGroup.get(gk) === token) this._sendQueueByGroup.delete(gk);
      }
    };

    // Heuristic 1: ignore exact duplicates already queued/in-flight.
    if (exactKey) {
      const existing = this._sendQueueByExact.get(exactKey);
      // Only treat it as a duplicate if it's for the current queue generation and hasn't been cancelled.
      // Never keep historical "already sent" commands in the dedupe maps.
      if (existing && (existing.gen !== this._sendQueueGen || existing.cancelled)) {
        cleanupDedupe(existing);
      } else if (existing) {
        return existing.promise || true;
      }
    }

    // Heuristic 2: coalesce per target (latest wins): cancel older queued commands for same targets.
    const cancelled = new Set();
    for (const gk of groupKeys) {
      const prev = this._sendQueueByGroup.get(gk);
      if (prev && !prev.cancelled) cancelled.add(prev);
    }
    for (const prev of cancelled) {
      // Only drop commands that haven't started sending yet.
      if (prev.started) continue;
      prev.cancelled = true;
      if (prev.exactKey && this._sendQueueByExact.get(prev.exactKey) === prev) this._sendQueueByExact.delete(prev.exactKey);
      for (const gk of prev.groupKeys || []) {
        if (this._sendQueueByGroup.get(gk) === prev) this._sendQueueByGroup.delete(gk);
      }
      this._sendQueuePending = Math.max(0, this._sendQueuePending - 1);
    }

    this._sendQueuePending += 1;
    this._emitSendQueueStats();

    const token = {
      id: (this._sendQueueItemId += 1),
      started: false,
      cancelled: false,
      gen,
      enqueuedAt,
      payload: p,
      blockUntil,
      enqueueOnly: Boolean(enqueueOnly),
      exactKey,
      groupKeys,
      promise: null,
    };
    const run = async () => {
      token.started = true;
      this._sendQueuePending = Math.max(0, this._sendQueuePending - 1);

      // If the queue has been flushed since this command was enqueued, drop it.
      if (gen !== this._sendQueueGen) {
        try {
          blockUntil?.catch?.(() => {});
        } catch (_) {
          // ignore
        }
        cleanupDedupe(token);
        return true;
      }

      // If a newer command superseded this one, drop it without sending.
      if (token.cancelled) {
        try {
          blockUntil?.catch?.(() => {});
        } catch (_) {
          // ignore
        }
        cleanupDedupe(token);
        return true;
      }

      this._sendQueueInFlight = true;
      this._sendQueueCurrentWaitMs = 0;
      this._emitSendQueueStats();
      const now = Date.now();
      const waitMs = Math.max(0, (this.commandSpacingMs ?? 0) - (now - this._lastSendAt));
      if (waitMs) await sleep(waitMs);
      this._sendQueueCurrentWaitMs = Math.max(0, Date.now() - enqueuedAt);
      this._emitSendQueueStats();
      try {
        this.emit('tx', { payload: Buffer.from(p || []), cmd, meta: { cmd } });
      } catch (_) {
        // ignore logging issues; never block device writes
      }
      try {
        const res = await this.client.send(p);
        this._lastSendAt = Date.now();
        const autoBlock = token.enqueueOnly
          ? null
          : blockUntil ||
            (this.singleFlight && typeof cmd === 'number'
              ? this._waitForFrameCmd(cmd, { timeoutMs: this.singleFlightTimeoutMs }).catch(() => null)
              : null);
        if (autoBlock) await autoBlock;
        return res;
      } finally {
        this._sendQueueInFlight = false;
        this._sendQueueCurrentWaitMs = 0;
        this._emitSendQueueStats();
        cleanupDedupe(token);
      }
    };

    if (enqueueOnly) {
      const runSafe = async () => {
        try {
          await run();
        } catch (e) {
          this.emit('transportError', { message: e?.message || String(e), ctx: { cmd, payload: p } });
        }
      };
      this._sendQueue = this._sendQueue.then(runSafe, runSafe);
      if (exactKey) this._sendQueueByExact.set(exactKey, token);
      for (const gk of groupKeys) this._sendQueueByGroup.set(gk, token);
      return true;
    }

    const chained = this._sendQueue.then(run, run);
    token.promise = chained;
    this._sendQueue = chained;
    if (exactKey) this._sendQueueByExact.set(exactKey, token);
    for (const gk of groupKeys) this._sendQueueByGroup.set(gk, token);
    return chained;
  }

  // ----------------- Public API -----------------
  async refreshStatus({ timeoutMs } = {}) {
    const t = Number(timeoutMs ?? (this.state.status08 ? 1500 : 4000));
    const pending = this._waitForStatus(Number.isFinite(t) ? t : 1500);
    await this._send([0x08, 0x00], { blockUntil: pending });
    return this.state.status08;
  }

  getStatus() {
    return this.state.status08;
  }

  getInfo() {
    const s = this.state.status08;
    return {
      firmware: s?.text || null,
      modules: s || null,
      battery: this.state.battery,
    };
  }

  async enableDetected() {
    const s = this.state.status08 || (await this.refreshStatus());
    if (!s) return;
    const enableSet = [
      { type: 0x01, mask: s.masks.ir },
      { type: 0x04, mask: s.masks.eyes },
      { type: 0x06, mask: s.masks.ultrasonic },
      { type: 0x08, mask: s.masks.speakers },
    ].filter((x) => x.mask);
    for (const cfg of enableSet) {
      const pending = this._waitForFrameCmd(0x71, { timeoutMs: 1200 });
      await this._send([0x71, cfg.type, cfg.mask, 0x00], { blockUntil: pending });
      await sleep(120);
    }
  }

  async requestBattery() {
    const pending = this._waitForBattery(1500);
    await this._send([0x27, 0x00], { blockUntil: pending });
    return this.state.battery;
  }

  async queryErrors() {
    await this._send([0x05, 0x00]);
  }

  // Servos
  async setServoPositions({ ids = [], positions = [], speed = 0x14, tail = [0x00, 0x00], enqueueOnly = false } = {}) {
    if (!ids.length) throw new Error('No servo ids provided');
    const select = idsToMaskBytes32(ids);
    const payload = [0x09, ...select, ...positions.slice(0, ids.length), clampByte(speed), ...tail];
    await this._send(payload, { enqueueOnly });
  }

  async setServoPositionDeg(id, deg, { speed = 0x14, tail = [0x00, 0x00], enqueueOnly = false } = {}) {
    return this.setServoPositions({ ids: [id], positions: [servoDegToRaw(deg)], speed, tail, enqueueOnly });
  }

  async setServoPositionsDeg({ ids = [], degrees = [], speed = 0x14, tail = [0x00, 0x00], enqueueOnly = false } = {}) {
    const positions = degrees.slice(0, ids.length).map(servoDegToRaw);
    return this.setServoPositions({ ids, positions, speed, tail, enqueueOnly });
  }

  async rotateServo(id, direction, velocity, { enqueueOnly = false } = {}) {
    return this.rotateServos([id], direction, velocity, { enqueueOnly });
  }

  async rotateServos(ids, direction, velocity, { enqueueOnly = false } = {}) {
    const list = Array.isArray(ids) ? ids.map((x) => clampByte(x)).filter((x) => x > 0) : [];
    if (!list.length) throw new Error('No servo ids provided');
    if (list.length > 6) throw new Error('rotateServos supports up to 6 ids per command');
    const vel = Math.max(0, Math.min(0xffff, velocity || 0));
    const hi = (vel >> 8) & 0xff;
    const lo = vel & 0xff;
    await this._send([0x07, clampByte(list.length), ...list, clampByte(direction), hi, lo], { enqueueOnly });
  }

  async readServoPosition(id = 0, { timeoutMs = 1200 } = {}) {
    // id=0 => all (no awaited result)
    const targetId = clampByte(id);
    if (targetId && !this.state?.connected) throw new Error('Not connected');

    const wait = targetId ? this._waitForServoPositionCancelable(targetId, timeoutMs) : null;
    try {
      await this._send([0x0b, targetId, 0x00], { blockUntil: wait?.promise || null });
    } catch (e) {
      if (wait) wait.cancel();
      throw e;
    }
    return wait ? wait.promise : null;
  }

  _waitForServoPosition(id, timeoutMs) {
    return new Promise((resolve, reject) => {
      const onPos = (data) => {
        if (data?.id !== id) return;
        cleanup();
        resolve(data);
      };
      const onDisconnect = () => {
        cleanup();
        reject(new Error('Disconnected while waiting for servo position'));
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out waiting for servo ${id} position`));
      }, Math.max(100, timeoutMs ?? 1200));

      const cleanup = () => {
        clearTimeout(timer);
        this.removeListener('servoPosition', onPos);
        this.removeListener('disconnect', onDisconnect);
      };

      this.on('servoPosition', onPos);
      this.on('disconnect', onDisconnect);
    });
  }

  _waitForServoPositionCancelable(id, timeoutMs) {
    let done = false;
    let resolveOuter;
    let rejectOuter;
    let timer = null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      this.removeListener('servoPosition', onPos);
      this.removeListener('disconnect', onDisconnect);
    };

    const onPos = (data) => {
      if (done) return;
      if (data?.id !== id) return;
      done = true;
      cleanup();
      resolveOuter(data);
    };

    const onDisconnect = () => {
      if (done) return;
      done = true;
      cleanup();
      rejectOuter(new Error('Disconnected while waiting for servo position'));
    };

    timer = setTimeout(() => {
      if (done) return;
      done = true;
      cleanup();
      rejectOuter(new Error(`Timed out waiting for servo ${id} position`));
    }, Math.max(100, timeoutMs ?? 1200));

    const promise = new Promise((resolve, reject) => {
      resolveOuter = resolve;
      rejectOuter = reject;
    });

    this.on('servoPosition', onPos);
    this.on('disconnect', onDisconnect);

    return {
      promise,
      cancel: () => {
        if (done) return;
        done = true;
        cleanup();
        resolveOuter(null);
      },
    };
  }

  async changeServoId(fromId, toId) {
    await this._send([0x0c, clampByte(fromId), clampByte(toId)]);
  }

  // Motors
  async rotateMotor(id, speed = 0, durationMs = 6000, { enqueueOnly = false } = {}) {
    // speed: roughly -150..150 observed; encoded as signed 16-bit, duration capped ~6s (0.1s units)
    const speedBytes = encodeMotorSpeed(speed);
    const timeBytes = encodeMotorDuration(durationMs);
    await this._send([0x90, 0x01, clampByte(id), speedBytes.hi, speedBytes.lo, timeBytes.hi, timeBytes.lo], { enqueueOnly });
  }

  async rotateDualMotor(idMask, speed1 = 0, speed2 = 0, durationMs = 6000, { enqueueOnly = false } = {}) {
    // idMask: bitmask of motor IDs (0x03 => motors 1+2), speeds applied in ascending ID order
    const s1 = encodeMotorSpeed(speed1);
    const s2 = encodeMotorSpeed(speed2);
    const timeBytes = encodeMotorDuration(durationMs);
    await this._send([
      0x90,
      0x01,
      clampByte(idMask),
      s1.hi,
      s1.lo,
      timeBytes.hi,
      timeBytes.lo,
      s2.hi,
      s2.lo,
      timeBytes.hi,
      timeBytes.lo,
    ], { enqueueOnly });
  }

  async stopMotor(id) {
    await this.rotateMotor(id, 0, 1000);
  }

  // Sensors
  async readIR(id = 1, { timeoutMs = 1200 } = {}) {
    const targetId = clampByte(id);
    const waiter = targetId ? this._makeSensorWaiter({ type: SENSOR_TYPE.IR, id: targetId, timeoutMs }) : null;
    try {
      await this._send([0x7e, 0x01, SENSOR_TYPE.IR, targetId], { blockUntil: waiter?.promise || null });
    } catch (e) {
      waiter?.cleanup?.();
      throw e;
    }
    return waiter ? waiter.promise : null;
  }

  async readUltrasonic(id = 1, { timeoutMs = 1200 } = {}) {
    const targetId = clampByte(id);
    const waiter = targetId ? this._makeSensorWaiter({ type: SENSOR_TYPE.ULTRASONIC, id: targetId, timeoutMs }) : null;
    try {
      await this._send([0x7e, 0x01, SENSOR_TYPE.ULTRASONIC, targetId], { blockUntil: waiter?.promise || null });
    } catch (e) {
      waiter?.cleanup?.();
      throw e;
    }
    return waiter ? waiter.promise : null;
  }

  _makeSensorWaiter({ type, id, timeoutMs }) {
    let cleanup = () => {};
    const promise = new Promise((resolve, reject) => {
      const onSensor = (evt) => {
        const readings = evt?.parsed?.readings || [];
        const match = readings.find((r) => r.type === type && r.id === id);
        if (!match) return;
        cleanup();
        resolve(match);
      };
      const onDisconnect = () => {
        cleanup();
        reject(new Error('Disconnected while waiting for sensor'));
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out waiting for sensor type=0x${type.toString(16)} id=${id}`));
      }, Math.max(100, timeoutMs ?? 1200));

      cleanup = () => {
        clearTimeout(timer);
        this.removeListener('sensor', onSensor);
        this.removeListener('disconnect', onDisconnect);
      };

      this.on('sensor', onSensor);
      this.on('disconnect', onDisconnect);
    });
    return { promise, cleanup };
  }

  async readAllSensors(status = this.state.status08) {
    const s = status || this.state.status08 || (await this.refreshStatus());
    if (!s) return;
    const sensors = [
      ...s.ir.map((id) => ({ type: 0x01, id })),
      ...s.ultrasonic.map((id) => ({ type: 0x06, id })),
    ];
    if (!sensors.length) return;
    // Protocol warning: only one sensor of a given type per frame.
    const queue = [...sensors];
    while (queue.length) {
      const batch = [];
      const seen = new Set();
      for (let i = 0; i < queue.length; ) {
        const entry = queue[i];
        if (seen.has(entry.type)) {
          i += 1;
          continue;
        }
        seen.add(entry.type);
        batch.push(entry);
        queue.splice(i, 1);
      }
      const payload = [0x7e, clampByte(batch.length)];
      batch.forEach((x) => payload.push(x.type, x.id));
      const pending = this._waitForFrameCmd(0x7e, { timeoutMs: 1500 });
      await this._send(payload, { blockUntil: pending });
      await sleep(50);
    }
  }

  // Eyes
  async setEyeColor({ eyesMask = 0x01, time = 0xff, r = 0xff, g = 0x00, b = 0x00, enqueueOnly = false } = {}) {
    await this._send([0x79, 0x04, clampByte(eyesMask), clampByte(time), 0x01, 0xff, clampByte(r), clampByte(g), clampByte(b)], { enqueueOnly });
  }

  // Ultrasonic LED (experimental)
  async setUltrasonicLed({ id = 1, r = 0xff, g = 0x00, b = 0x00, enqueueOnly = false } = {}) {
    // Per docs/protocol.md:
    //   79 06 <id> <r> <g> <b> <level> 00 ff ff
    // level: 0=off, 1=bright, 2+=dim; we always use 1 and allow "off" by sending 0,0,0.
    await this._send([0x79, 0x06, clampByte(id), clampByte(r), clampByte(g), clampByte(b), 0x01, 0x00, 0xff, 0xff], { enqueueOnly });
  }

  async setUltrasonicLedOff(id = 1, { enqueueOnly = false } = {}) {
    await this.setUltrasonicLed({ id, r: 0x00, g: 0x00, b: 0x00, enqueueOnly });
  }

  async setEyeSegments({ eyesMask = 0x01, time = 0xff, entries = [], enqueueOnly = false } = {}) {
    const payload = [0x79, 0x04, clampByte(eyesMask), 0x02, clampByte(entries.length), clampByte(time)];
    entries.forEach(({ r, g, b, mask }) => {
      payload.push(clampByte(r ?? 0), clampByte(g ?? 0), clampByte(b ?? 0), clampByte(mask ?? 0x01));
    });
    await this._send(payload, { enqueueOnly });
  }

  async setEyeAnimation({ eyesMask = 0x01, animationId = 1, repetitions = 1, r = 0xff, g = 0x00, b = 0x00, enqueueOnly = false } = {}) {
    // Per docs/protocol.md:
    //   78 04 <eyesMask> <animationId> 00 <repetitions> <r> <g> <b>
    await this._send([
      0x78,
      0x04,
      clampByte(eyesMask),
      clampByte(animationId),
      0x00,
      clampByte(repetitions),
      clampByte(r),
      clampByte(g),
      clampByte(b),
    ], { enqueueOnly });
  }

  // Change IDs (sensors/motors/eyes/ultrasonic)
  async changePeripheralId({ type, fromId, toId }) {
    await this._send([0x74, clampByte(type), clampByte(fromId), clampByte(toId)]);
  }

  async fixSensorFromZero({ type = 0x01, toId = 0x02 } = {}) {
    await this.changePeripheralId({ type, fromId: 0x00, toId });
  }

  async emergencyStop({ refresh = false } = {}) {
    // Drop any queued (not-yet-sent) commands so stop actions run as soon as possible.
    // Note: we can't interrupt an in-flight command; we only clear pending work.
    this.flushSendQueue();

    const s = refresh ? await this.refreshStatus() : this.state.status08;
    // Best effort: stop motors and rotations, then release servos by reading all positions.
    const motorIds = s?.motors || [];
    const servoIds = s?.servos || [];
    const eyeIds = s?.eyes || [];
    const usIds = s?.ultrasonic || [];

    for (const id of motorIds) {
      try {
        await this.stopMotor(id);
        await sleep(40);
      } catch (_) {
        // ignore; continue best-effort stop
      }
    }
    for (const id of servoIds) {
      try {
        await this.rotateServo(id, 0x01, 0);
        await sleep(25);
      } catch (_) {
        // ignore
      }
    }
    try {
      await this.readServoPosition(0); // id=0 => read all; known to release servo hold
    } catch (_) {
      // ignore
    }
    if (eyeIds.length) {
      try {
        await this.setEyeColor({ eyesMask: idsToMaskByte(eyeIds), time: 0x00, r: 0x00, g: 0x00, b: 0x00 });
        await sleep(25);
      } catch (_) {
        // ignore
      }
    }
    for (const id of usIds) {
      try {
        await this.setUltrasonicLedOff(id);
        await sleep(25);
      } catch (_) {
        // ignore
      }
    }
  }
}

export class WheeledDrive {
  constructor(jimu, { left = [], right = [], invertLeft = false, invertRight = true } = {}) {
    this.jimu = jimu;
    this.left = left;
    this.right = right;
    this.invertLeft = invertLeft;
    this.invertRight = invertRight;
  }

  async drive(speed = 0, turn = 0) {
    // speed/turn in -100..100; differential mix
    const forward = Math.max(-100, Math.min(100, speed));
    const turnVal = Math.max(-100, Math.min(100, turn));
    const leftSpeed = forward + turnVal;
    const rightSpeed = forward - turnVal;
    await Promise.all([
      this._driveGroup(this.left, leftSpeed, this.invertLeft),
      this._driveGroup(this.right, rightSpeed, this.invertRight),
    ]);
  }

  async _driveGroup(ids, speed, invert) {
    const dirSpeed = invert ? -speed : speed;
    const direction = dirSpeed >= 0 ? 0x01 : 0x02;
    const velocity = Math.round(Math.abs(dirSpeed) * 10); // coarse scaling
    for (const id of ids) {
      await this.jimu.rotateServo(id, direction, velocity);
    }
  }
}

export const utils = { parseStatus08, idsToMaskBytes32, idsToMaskByte, maskBytesToIds };
