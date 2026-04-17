import * as Blockly from 'blockly';
import { batteryPercentFromVolts } from '../battery.js';
import * as globalVars from './global_vars.js';
import * as controllerState from '../controller/controller_state.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const hexToRgb = (hex) => {
  const s = String(hex || '').trim();
  const m = s.match(/^#?([0-9a-fA-F]{6})$/);
  if (!m) return { r: 0, g: 0, b: 0 };
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
};

const eyeIdToMask = (id) => {
  const n = Math.max(1, Math.min(8, Math.round(Number(id ?? 1))));
  return 1 << (n - 1);
};

// Observed mapping note: "first LED is NE" -> assume bit0=NE, then clockwise.
const eyeSegmentCompassOrder = ['NE', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'N'];
const eyeSegmentMaskForCompass = (pos) => {
  const idx = eyeSegmentCompassOrder.indexOf(pos);
  if (idx < 0) return 0;
  return 1 << idx;
};

const ACTION_FRAME_MIN_MS = 50;
const ACTION_FRAME_MAX_MS = 5000;

const normalizeActionJson = (actionJson, actionMeta) => {
  const meta = actionMeta && typeof actionMeta === 'object' ? actionMeta : {};
  const base = {
    id: String(meta?.id || ''),
    name: String(meta?.name || ''),
    servoIds: Array.isArray(meta?.servoIds) ? meta.servoIds.map(Number).filter((n) => Number.isFinite(n)) : [],
    frames: [],
  };
  const obj = actionJson && typeof actionJson === 'object' ? actionJson : {};
  const framesRaw = Array.isArray(obj.frames) ? obj.frames : [];
  const frames = framesRaw
    .map((f) => {
      const durationMs = clamp(Number(f?.durationMs ?? 400), ACTION_FRAME_MIN_MS, ACTION_FRAME_MAX_MS);
      const poseDeg = f?.poseDeg && typeof f.poseDeg === 'object' ? f.poseDeg : {};
      return { durationMs, poseDeg };
    })
    .filter(Boolean);
  return {
    ...base,
    ...obj,
    id: base.id || String(obj?.id || ''),
    name: String(obj?.name ?? base.name),
    servoIds: base.servoIds.length ? base.servoIds : Array.isArray(obj?.servoIds) ? obj.servoIds : [],
    frames,
  };
};

export const createRoutineApi = ({
  ipc,
  projectId,
  calibration,
  projectModules,
  projectActions,
  actionJsonRamCacheRef,
  actionsRuntimeRef,
  battery,
  addLog,
  appendTrace,
  cancelRef,
  getWorkspace, // () => workspace or null
  stepDelayMs = 0,
} = {}) => {
  const trace = typeof appendTrace === 'function' ? appendTrace : () => {};
  const log = typeof addLog === 'function' ? addLog : () => {};
  const getWs = typeof getWorkspace === 'function' ? getWorkspace : () => null;
  const cancel = cancelRef || { current: { isCancelled: false, onCancel: null } };

  const isCancelled = () => Boolean(cancel?.current?.isCancelled);

  const wait = async (ms) => {
    const delay = clamp(Number(ms ?? 0), 0, 60_000);
    if (isCancelled()) return;
    await new Promise((resolve) => {
      const t = setTimeout(resolve, delay);
      cancel.current.onCancel = () => {
        clearTimeout(t);
        resolve();
      };
    });
  };

  const actionJsonCacheRef = actionJsonRamCacheRef || { current: new Map() }; // actionId -> json
  const localActionsRuntime = { running: new Map() }; // actionId -> { stopRequested }
  const getActionsRuntime = () => {
    const cur = actionsRuntimeRef?.current ?? actionsRuntimeRef;
    if (cur?.running instanceof Map) return cur;
    if (cur instanceof Map) return { running: cur };
    return localActionsRuntime;
  };

  const servoSpeedByteFromDurationMs = (durationMs) => {
    const ms = clamp(Number(durationMs ?? 400), 0, 60_000);
    // Protocol note (docs/protocol.md): speed/20 = seconds for movement => speed ~= ms/50
    return clamp(Math.round(ms / 50), 0, 0xff);
  };

  const setServoPosition = async (id, deg) => {
    if (!ipc) throw new Error('IPC unavailable');
    if (isCancelled()) return;
    const servoId = Number(id ?? 0);
    const c = calibration?.servoConfig?.[servoId] || {};
    const min = typeof c.min === 'number' ? c.min : -120;
    const max = typeof c.max === 'number' ? c.max : 120;
    const reverse = Boolean(c.reverse);
    const ui = clamp(Number(deg ?? 0), min, max);
    const posDeg = reverse ? -ui : ui;
    await ipc.invoke('jimu:setServoPos', { id: servoId, posDeg });
  };

  const setServoPositionsTimed = async (entries, durationMs = 400) => {
    if (!ipc) throw new Error('IPC unavailable');
    if (isCancelled()) return;

    const ms = clamp(Number(durationMs ?? 400), 0, 60_000);
    const speed = servoSpeedByteFromDurationMs(ms);

    const list = Array.isArray(entries) ? entries : [];
    const servoConfig = calibration?.servoConfig || {};

    // Deduplicate by ID (last wins), then sort ascending.
    const byId = new Map();
    for (const e of list) {
      const servoId = Number(e?.id ?? 0);
      if (!Number.isFinite(servoId) || servoId <= 0) continue;
      const c = servoConfig?.[servoId] || servoConfig?.[String(servoId)] || {};
      const min = typeof c.min === 'number' ? c.min : -120;
      const max = typeof c.max === 'number' ? c.max : 120;
      const reverse = Boolean(c.reverse);
      const ui = clamp(Number(e?.deg ?? 0), min, max);
      const posDeg = reverse ? -ui : ui;
      byId.set(servoId, posDeg);
    }

    const ids = Array.from(byId.keys()).sort((a, b) => a - b);
    if (!ids.length) return;
    const degrees = ids.map((id) => byId.get(id));

    await ipc.invoke('jimu:setServoPosMulti', { ids, degrees, speed });
  };

  const setServoPositionTimed = async (id, deg, durationMs = 400) => {
    await setServoPositionsTimed([{ id, deg }], durationMs);
  };

  const rotateServo = async (id, dir, speed) => {
    if (!ipc) throw new Error('IPC unavailable');
    if (isCancelled()) return;
    const servoId = Number(id ?? 0);
    const c = calibration?.servoConfig?.[servoId] || {};
    const maxSpeed = typeof c.maxSpeed === 'number' ? c.maxSpeed : 1000;
    const reverse = Boolean(c.reverse);
    const cleanDir = String(dir) === 'ccw' ? 'ccw' : 'cw';
    const speedNum = Number(speed ?? 0);
    const baseDir = speedNum < 0 ? (cleanDir === 'cw' ? 'ccw' : 'cw') : cleanDir;
    const baseSpeed = Math.abs(speedNum);
    const finalDir = reverse ? (baseDir === 'cw' ? 'ccw' : 'cw') : baseDir;
    const dirByte = finalDir === 'cw' ? 0x01 : 0x02;
    await ipc.invoke('jimu:rotateServo', { id: servoId, dir: dirByte, speed: baseSpeed, maxSpeed });
  };

  const rotateServoMulti = async (ids, dir, speed) => {
    if (!ipc) throw new Error('IPC unavailable');
    if (isCancelled()) return;

    const list = Array.isArray(ids) ? ids.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0) : [];
    if (!list.length) return;

    const cleanDir = String(dir) === 'ccw' ? 'ccw' : 'cw';
    const speedNum = Number(speed ?? 0);
    const baseDir = speedNum < 0 ? (cleanDir === 'cw' ? 'ccw' : 'cw') : cleanDir;
    const baseSpeedRaw = Math.abs(speedNum);
    const cfg = calibration?.servoConfig || {};

    // Clamp speed to the most restrictive maxSpeed among ALL selected servos.
    let globalMax = 1000;
    for (const servoId of list) {
      const c = cfg?.[servoId] || cfg?.[String(servoId)] || {};
      const maxSpeed = typeof c.maxSpeed === 'number' ? c.maxSpeed : 1000;
      globalMax = Math.min(globalMax, maxSpeed);
    }
    const baseSpeed = Math.max(0, Math.min(globalMax, baseSpeedRaw));

    // Partition IDs into cw/ccw after applying per-servo reverse calibration.
    const cwIds = [];
    const ccwIds = [];
    for (const servoId of list) {
      const c = cfg?.[servoId] || cfg?.[String(servoId)] || {};
      const reverse = Boolean(c.reverse);
      const finalDir = reverse ? (baseDir === 'cw' ? 'ccw' : 'cw') : baseDir;
      (finalDir === 'cw' ? cwIds : ccwIds).push(servoId);
    }

    if (cwIds.length) await ipc.invoke('jimu:rotateServoMulti', { ids: cwIds, dir: 0x01, speed: baseSpeed });
    if (ccwIds.length) await ipc.invoke('jimu:rotateServoMulti', { ids: ccwIds, dir: 0x02, speed: baseSpeed });
  };

  const stopServo = async (id) => rotateServo(id, 'cw', 0);
  const stopServosMulti = async (ids) => rotateServoMulti(ids, 'cw', 0);

  const rotateMotor = async (id, speed, durationMs = 5000) => {
    if (!ipc) throw new Error('IPC unavailable');
    if (isCancelled()) return;
    const motorId = Number(id ?? 0);
    const c = calibration?.motorConfig?.[motorId] || {};
    const maxSpeed = typeof c.maxSpeed === 'number' ? c.maxSpeed : 150;
    const reverse = Boolean(c.reverse);
    const cleanSpeed = clamp(Number(speed ?? 0), -maxSpeed, maxSpeed);
    const finalSpeed = reverse ? -cleanSpeed : cleanSpeed;
    const dur = clamp(Number(durationMs ?? 5000), 0, 6000);
    // Use signed motor API (Controller tab runs routines without the RoutinesTab helpers).
    await ipc.invoke('jimu:rotateMotorSigned', { id: motorId, speed: finalSpeed, maxSpeed, durationMs: dur });
  };

  const rotateMotorsTimed = async (entries, durationMs = 5000) => {
    if (!ipc) throw new Error('IPC unavailable');
    if (isCancelled()) return;

    const dur = clamp(Number(durationMs ?? 5000), 0, 6000);
    const list = Array.isArray(entries) ? entries : [];
    const cfg = calibration?.motorConfig || {};

    const byId = new Map();
    for (const e of list) {
      const motorId = Number(e?.id ?? 0);
      if (!Number.isFinite(motorId) || motorId <= 0) continue;
      const c = cfg?.[motorId] || cfg?.[String(motorId)] || {};
      const maxSpeed = typeof c.maxSpeed === 'number' ? c.maxSpeed : 150;
      const reverse = Boolean(c.reverse);
      const cleanSpeed = clamp(Number(e?.speed ?? 0), -maxSpeed, maxSpeed);
      const finalSpeed = reverse ? -cleanSpeed : cleanSpeed;
      byId.set(motorId, finalSpeed);
    }
    const ids = Array.from(byId.keys()).sort((a, b) => a - b);
    if (!ids.length) return;

    // Send per-motor to respect single-flight constraints and avoid missing IPC handlers.
    for (const motorId of ids) {
      if (isCancelled()) return;
      const c = cfg?.[motorId] || cfg?.[String(motorId)] || {};
      const maxSpeed = typeof c.maxSpeed === 'number' ? c.maxSpeed : 150;
      const signed = clamp(Number(byId.get(motorId) ?? 0), -maxSpeed, maxSpeed);
      await ipc.invoke('jimu:rotateMotorSigned', { id: motorId, speed: signed, maxSpeed, durationMs: dur });
    }
  };

  const stopMotor = async (id) => rotateMotor(id, 0, 0);
  const stopMotorsMulti = async (ids) => rotateMotorsTimed((ids || []).map((id) => ({ id, speed: 0 })), 0);

  const readIR = async (id) => {
    if (!ipc) throw new Error('IPC unavailable');
    if (isCancelled()) return 0;
    const res = await ipc.invoke('jimu:readSensorIR', Number(id ?? 1));
    if (res?.error) throw new Error(res.message || 'IR read failed');
    return Number(res?.value ?? 0);
  };

  const readUltrasonicCm = async (id) => {
    if (!ipc) throw new Error('IPC unavailable');
    if (isCancelled()) return 0;
    const res = await ipc.invoke('jimu:readSensorUS', Number(id ?? 1));
    if (res?.error) throw new Error(res.message || 'US read failed');
    const raw = Number(res?.value ?? 0);
    if (!raw) return 301.0;
    return raw / 10;
  };

  const readServoDeg = async (id) => {
    if (!ipc) throw new Error('IPC unavailable');
    const servoId = Number(id ?? 0);
    const res = await ipc.invoke('jimu:readServo', servoId);
    const deg = Number(res?.deg ?? 0);
    const c = calibration?.servoConfig?.[servoId] || {};
    const reverse = Boolean(c.reverse);
    return reverse ? -deg : deg;
  };

  const getSlider = (name) => controllerState.sliderGet(String(name ?? ''));
  const getJoystick = (name, axis) =>
    controllerState.joystickGetAxis(String(name ?? ''), String(axis ?? 'x') === 'y' ? 'y' : 'x');
  const getButton = (name) => controllerState.switchGet(String(name ?? ''));
  const getSwitch = (name) => getButton(name); // back-compat

  const loadActionJson = async (actionId) => {
    const id = String(actionId || '');
    if (!id) return null;
    const cached = actionJsonCacheRef.current.get(id);
    if (cached !== undefined) return cached;
    if (!ipc || !projectId) return null;
    try {
      const res = await ipc.invoke('action:loadJson', { projectId, actionId: id });
      const obj = res?.json && typeof res.json === 'object' ? res.json : null;
      const meta = (Array.isArray(projectActions) ? projectActions : []).find((a) => String(a?.id) === id) || null;
      const normalized = normalizeActionJson(obj, meta || { id, name: id, servoIds: [] });
      actionJsonCacheRef.current.set(id, normalized);
      return normalized;
    } catch (_) {
      return null;
    }
  };

  const stopAction = (actionId) => {
    const id = String(actionId || '').trim();
    if (!id) return;
    try {
      const rt = getActionsRuntime();
      const v = rt.running.get(id);
      if (v && typeof v === 'object') v.stopRequested = true;
    } catch (_) {
      // ignore
    }
  };

  const stopAllActions = () => {
    try {
      const rt = getActionsRuntime();
      for (const v of rt.running.values()) {
        if (v && typeof v === 'object') v.stopRequested = true;
      }
    } catch (_) {
      // ignore
    }
  };

  const playAction = async (actionId) => {
    const id = String(actionId || '').trim();
    if (!id) return;
    if (!ipc) throw new Error('IPC unavailable');
    if (isCancelled()) return;

    const rt = getActionsRuntime();
    if (rt.running.has(id)) return; // ignore if already running
    const run = { stopRequested: false };
    rt.running.set(id, run);

    const meta = (Array.isArray(projectActions) ? projectActions : []).find((a) => String(a?.id) === id) || null;
    const action = (await loadActionJson(id)) || null;
    const servoIds = (meta?.servoIds || action?.servoIds || []).map(Number).filter((n) => Number.isFinite(n) && n > 0);
    const frames = Array.isArray(action?.frames) ? action.frames : [];
    if (!frames.length) {
      rt.running.delete(id);
      return;
    }

    try {
        for (const f of frames) {
        if (isCancelled()) {
          run.stopRequested = true;
          return;
        }
        if (run.stopRequested) return;
          const durationMs = clamp(Number(f?.durationMs ?? 400), ACTION_FRAME_MIN_MS, ACTION_FRAME_MAX_MS);
        const poseDeg = f?.poseDeg && typeof f.poseDeg === 'object' ? f.poseDeg : {};
          const entries = servoIds
            .map((sid) => ({ id: sid, deg: poseDeg[String(sid)] }))
            .filter((e) => typeof e.deg === 'number' && Number.isFinite(e.deg));
          await setServoPositionsTimed(entries, durationMs);
          await wait(durationMs);
        }
      } finally {
        rt.running.delete(id);
      }
  };

  const selectAction = (actionId) => playAction(actionId);

  const eyeColorMask = async (eyesMask, hex) => {
    if (!ipc) throw new Error('IPC unavailable');
    if (isCancelled()) return;
    const { r, g, b } = hexToRgb(hex);
    await ipc.invoke('jimu:setEyeColor', { eyesMask: clamp(Number(eyesMask ?? 0), 0, 0xff), time: 0xff, r, g, b });
  };

  const eyeColorForMask = async (eyesMask, hex, durationMs = 400) => {
    await eyeColorMask(eyesMask, hex);
    await wait(clamp(Number(durationMs ?? 400), 0, 60_000));
    await eyeOffMask(eyesMask);
  };

  const eyeSceneMask = async (eyesMask, hex, scene, repeat, waitForDone) => {
    if (!ipc) throw new Error('IPC unavailable');
    if (isCancelled()) return;
    const { r, g, b } = hexToRgb(hex);
    await ipc.invoke('jimu:setEyeScene', {
      eyesMask: clamp(Number(eyesMask ?? 0), 0, 0xff),
      r,
      g,
      b,
      scene: clamp(Number(scene ?? 1), 1, 15),
      repeat: clamp(Number(repeat ?? 1), 0, 255),
      wait: Boolean(waitForDone),
    });
    if (waitForDone) trace('Note: eye scene wait is best-effort (no completion signal from the brick yet).');
  };

  const eyeCustom = async (eyesMask, entries) => {
    if (!ipc) throw new Error('IPC unavailable');
    if (isCancelled()) return;
    await ipc.invoke('jimu:setEyeSegments', { eyesMask: clamp(Number(eyesMask ?? 0), 0, 0xff), time: 0xff, entries });
  };

  const eyeCustomFor = async (eyesMask, entries, durationMs = 400) => {
    await eyeCustom(eyesMask, entries);
    await wait(clamp(Number(durationMs ?? 400), 0, 60_000));
    await eyeOffMask(eyesMask);
  };

  const eyeCustom8Mask = async (eyesMask, colorsByPos) => {
    if (!ipc) throw new Error('IPC unavailable');
    if (isCancelled()) return;
    const maskAll = clamp(Number(eyesMask ?? 0), 0, 0xff);
    if (!maskAll) return;
    const entries = eyeSegmentCompassOrder.map((pos) => {
      const hex = colorsByPos?.[pos] || '#000000';
      const { r, g, b } = hexToRgb(hex);
      const mask = eyeSegmentMaskForCompass(pos);
      return { r, g, b, mask };
    });
    await ipc.invoke('jimu:setEyeSegments', { eyesMask: maskAll, time: 0xff, entries });
  };

  const eyeCustom8ForMask = async (eyesMask, colorsByPos, durationMs = 400) => {
    await eyeCustom8Mask(eyesMask, colorsByPos);
    await wait(clamp(Number(durationMs ?? 400), 0, 60_000));
    await eyeOffMask(eyesMask);
  };

  const eyeOffMask = async (eyesMask) => {
    if (!ipc) throw new Error('IPC unavailable');
    if (isCancelled()) return;
    await ipc.invoke('jimu:setEyeOff', { eyesMask: clamp(Number(eyesMask ?? 0), 0, 0xff) });
  };

  const usLedColor = async (id, hex) => {
    if (!ipc) throw new Error('IPC unavailable');
    if (isCancelled()) return;
    const { r, g, b } = hexToRgb(hex);
    await ipc.invoke('jimu:setUltrasonicLed', { id: Number(id ?? 1), r, g, b });
  };

  const usLedOff = async (id) => {
    if (!ipc) throw new Error('IPC unavailable');
    if (isCancelled()) return;
    await ipc.invoke('jimu:setUltrasonicLedOff', { id: Number(id ?? 1) });
  };

  const indicatorColor = (name, hex) => {
    controllerState.indicatorSet(String(name || ''), String(hex || '#000000'));
  };

  const displayShow = (name, value) => {
    controllerState.displaySet(String(name || ''), value);
  };

  const allStop = async () => {
    if (!ipc) throw new Error('IPC unavailable');
    try {
      await ipc.invoke('jimu:emergencyStop');
    } catch (_) {
      // ignore
    }
    const modules = projectModules || {};
    const eyes = Array.isArray(modules.eyes) ? modules.eyes : [];
    const us = Array.isArray(modules.ultrasonic) ? modules.ultrasonic : [];
    for (const id of eyes) {
      try {
        await ipc.invoke('jimu:setEyeOff', { eyesMask: eyeIdToMask(id) });
      } catch (_) {
        // ignore
      }
    }
    for (const id of us) {
      try {
        await ipc.invoke('jimu:setUltrasonicLedOff', { id: Number(id ?? 1) });
      } catch (_) {
        // ignore
      }
    }
  };

  const emergencyStop = async () => {
    if (!ipc) throw new Error('IPC unavailable');
    cancel.current.isCancelled = true;
    stopAllActions();
    try {
      await allStop();
    } catch (_) {
      // ignore
    }
  };

  const batteryPercent = () => {
    const pct = batteryPercentFromVolts(battery?.volts);
    if (pct == null) return 0;
    return Math.round(pct * 100);
  };

  const batteryCharging = () => Boolean(battery?.charging);

  const print = (blockId, value) => {
    const ws = getWs();
    if (!ws) return;
    const b = ws?.getBlockById?.(String(blockId || ''));
    if (!b) return;
    Blockly.Events.disable();
    try {
      b.setFieldValue(String(value ?? ''), 'OUT');
    } finally {
      Blockly.Events.enable();
    }
  };

  const api = {
    __step: async (blockId) => {
      const ws = getWs();
      try {
        ws?.highlightBlock?.(blockId || null);
      } catch (_) {
        // ignore
      }
      if (isCancelled()) throw new Error('Cancelled');
      const extra = clamp(Number(stepDelayMs ?? 0), 0, 60_000);
      if (extra <= 0) return;
      const b = ws?.getBlockById ? ws.getBlockById(blockId) : null;
      const t = String(b?.type || '');
      if (t === 'jimu_wait' || t === 'jimu_wait_until') return;
      await wait(extra);
    },
    varGet: (name) => globalVars.varGet(String(name ?? '')),
    varSet: (name, value) => globalVars.varSet(String(name ?? ''), value),
    arrGet: (name, index) => globalVars.arrGet(String(name ?? ''), index),
    arrSet: (name, index, value) => globalVars.arrSet(String(name ?? ''), index, value),
    arrChange: (name, index, delta) => globalVars.arrChange(String(name ?? ''), index, delta),
    wait,
    setServoPosition,
    setServoPositionsTimed,
    setServoPositionTimed,
    rotateServo,
    rotateServoMulti,
    stopServo,
    stopServosMulti,
    rotateMotor,
    rotateMotorsTimed,
    stopMotor,
    stopMotorsMulti,
    readIR,
    readUltrasonicCm,
    readServoDeg,
    getSlider,
    getJoystick,
    getButton,
    getSwitch,
    selectAction,
    playAction,
    stopAction,
    stopAllActions,
    eyeColorMask,
    eyeColorForMask,
    eyeSceneMask,
    eyeCustom,
    eyeCustomFor,
    eyeCustom8Mask,
    eyeCustom8ForMask,
    eyeOffMask,
    usLedColor,
    usLedOff,
    indicatorColor,
    displayShow,
    allStop,
    emergencyStop,
    batteryPercent,
    batteryCharging,
    print,
    log: (t) => {
      trace(t);
      log(`[Routine] ${String(t ?? '')}`);
    },
  };

  return api;
};
