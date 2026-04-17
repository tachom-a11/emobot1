const store = new Map(); // routineId -> { count:number, totalMs:number, maxMs:number }
const listeners = new Set();

const nowMs = () => {
  try {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') return performance.now();
  } catch (_) {
    // ignore
  }
  return Date.now();
};

const emit = () => {
  for (const fn of Array.from(listeners)) {
    try {
      fn();
    } catch (_) {
      // ignore
    }
  }
};

export const clear = () => {
  store.clear();
  emit();
};

export const record = (routineId, durationMs) => {
  const id = String(routineId ?? '').trim();
  if (!id) return;
  const ms = Math.max(0, Number(durationMs ?? 0));
  const prev = store.get(id) || { count: 0, totalMs: 0, maxMs: 0 };
  const next = {
    count: prev.count + 1,
    totalMs: prev.totalMs + ms,
    maxMs: Math.max(prev.maxMs, ms),
  };
  store.set(id, next);
  emit();
};

export const start = (routineId) => {
  const id = String(routineId ?? '').trim();
  const startedAt = nowMs();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    if (!id) return;
    record(id, nowMs() - startedAt);
  };
};

export const getSnapshot = () => {
  const out = {};
  for (const [k, v] of store.entries()) out[k] = { ...(v || {}) };
  return out;
};

export const getTotals = () => {
  let count = 0;
  let totalMs = 0;
  let maxMs = 0;
  for (const v of store.values()) {
    count += Number(v?.count ?? 0) || 0;
    totalMs += Number(v?.totalMs ?? 0) || 0;
    maxMs = Math.max(maxMs, Number(v?.maxMs ?? 0) || 0);
  }
  return { count, totalMs, maxMs, avgMs: count ? totalMs / count : 0 };
};

export const subscribe = (fn) => {
  if (typeof fn !== 'function') return () => {};
  listeners.add(fn);
  return () => listeners.delete(fn);
};

