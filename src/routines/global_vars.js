const store = new Map(); // key: variable name, value: {value:any, init:any}
const arrays = new Map(); // key: array name, value: { value: Map<indexKey, number>, init: Map<indexKey, number> }

const normalizeEntry = (entry, fallback = 0) => {
  if (entry && typeof entry === 'object' && Object.prototype.hasOwnProperty.call(entry, 'value')) {
    return {
      value: entry.value,
      init: Object.prototype.hasOwnProperty.call(entry, 'init') ? entry.init : entry.value,
    };
  }
  return { value: entry ?? fallback, init: entry ?? fallback };
};

const normalizeNumber = (value, fallback = 0) => {
  const n = Number(value);
  if (Number.isFinite(n)) return n;
  return Number(fallback) || 0;
};

const normalizeIndexKey = (index) => {
  const n = Number(index);
  if (!Number.isFinite(n)) return '0';
  // Indices are numeric and may be negative; store as a normalized integer string key.
  return String(Math.trunc(n));
};

const normalizeArrayEntry = (entry) => {
  const raw = entry && typeof entry === 'object' ? entry : {};
  const rawValue = Object.prototype.hasOwnProperty.call(raw, 'value') ? raw.value : raw;
  const rawInit = Object.prototype.hasOwnProperty.call(raw, 'init') ? raw.init : rawValue;
  const valueMap = new Map();
  const initMap = new Map();

  const importMap = (m, obj) => {
    if (!obj || typeof obj !== 'object') return;
    for (const [k, v] of Object.entries(obj)) {
      const idxKey = normalizeIndexKey(k);
      m.set(idxKey, normalizeNumber(v, 0));
    }
  };
  importMap(valueMap, rawValue);
  importMap(initMap, rawInit);

  // If init is missing for some indices, default it to current value (similar to varSet first-write behavior).
  for (const [k, v] of valueMap.entries()) {
    if (!initMap.has(k)) initMap.set(k, v);
  }

  return { value: valueMap, init: initMap };
};

export const varGet = (name) => store.get(String(name ?? ''))?.value;

export const varSet = (name, value) => {
  const key = String(name ?? '');
  if (!key) return;
  const prev = store.get(key);
  const next = prev ? { ...prev, value } : { value, init: value };
  store.set(key, next);
};

export const varInitGet = (name) => store.get(String(name ?? ''))?.init;

export const varInitSet = (name, initValue) => {
  const key = String(name ?? '');
  if (!key) return;
  const prev = store.get(key);
  const next = prev ? { ...prev, init: initValue } : { value: initValue, init: initValue };
  store.set(key, next);
};

export const varResetToInit = () => {
  for (const [k, v] of store.entries()) {
    store.set(k, { ...(v || {}), value: v?.init });
  }
  for (const [k, v] of arrays.entries()) {
    const initMap = v?.init instanceof Map ? v.init : new Map();
    arrays.set(k, { ...(v || {}), value: new Map(initMap) });
  }
};

export const varDefine = (name, initialValue = 0) => {
  const key = String(name ?? '');
  if (!key) return;
  if (!store.has(key)) store.set(key, { value: initialValue, init: initialValue });
};

export const varList = () => Array.from(store.keys()).sort((a, b) => a.localeCompare(b));

export const varDelete = (name) => {
  const key = String(name ?? '');
  if (!key) return;
  store.delete(key);
};

export const varClearAll = () => {
  store.clear();
  arrays.clear();
};

export const varExport = () => Object.fromEntries(Array.from(store.entries()).map(([k, v]) => [k, { value: v?.value, init: v?.init }]));

export const varImport = (obj) => {
  store.clear();
  if (!obj || typeof obj !== 'object') return;
  for (const [k, v] of Object.entries(obj)) {
    const key = String(k ?? '');
    if (!key) continue;
    store.set(key, normalizeEntry(v, 0));
  }
};

export const arrDefine = (name) => {
  const key = String(name ?? '');
  if (!key) return;
  if (arrays.has(key)) return;
  arrays.set(key, { value: new Map(), init: new Map() });
};

export const arrList = () => Array.from(arrays.keys()).sort((a, b) => a.localeCompare(b));

export const arrDelete = (name) => {
  const key = String(name ?? '');
  if (!key) return;
  arrays.delete(key);
};

export const arrEntries = (name) => {
  const key = String(name ?? '');
  if (!key) return [];
  const entry = arrays.get(key);
  const valueMap = entry?.value instanceof Map ? entry.value : null;
  if (!valueMap) return [];
  const rows = Array.from(valueMap.entries()).map(([idxKey, value]) => ({
    index: Number(idxKey),
    value: Number(value),
  }));
  rows.sort((a, b) => {
    const ai = Number.isFinite(a.index) ? a.index : 0;
    const bi = Number.isFinite(b.index) ? b.index : 0;
    return ai - bi;
  });
  return rows;
};

export const arrGet = (name, index) => {
  const key = String(name ?? '');
  if (!key) return 0;
  const entry = arrays.get(key);
  if (!entry) return 0;
  const idxKey = normalizeIndexKey(index);
  const v = entry.value?.get?.(idxKey);
  return Number.isFinite(Number(v)) ? Number(v) : 0;
};

export const arrSet = (name, index, value) => {
  const key = String(name ?? '');
  if (!key) return;
  const idxKey = normalizeIndexKey(index);
  const n = normalizeNumber(value, 0);
  const prev = arrays.get(key);
  const valueMap = prev?.value instanceof Map ? prev.value : new Map();
  const initMap = prev?.init instanceof Map ? prev.init : new Map();
  valueMap.set(idxKey, n);
  if (!initMap.has(idxKey)) initMap.set(idxKey, n);
  arrays.set(key, { value: valueMap, init: initMap });
};

export const arrInitSet = (name, index, initValue) => {
  const key = String(name ?? '');
  if (!key) return;
  const idxKey = normalizeIndexKey(index);
  const n = normalizeNumber(initValue, 0);
  const prev = arrays.get(key);
  const valueMap = prev?.value instanceof Map ? prev.value : new Map();
  const initMap = prev?.init instanceof Map ? prev.init : new Map();
  if (!valueMap.has(idxKey)) valueMap.set(idxKey, n);
  initMap.set(idxKey, n);
  arrays.set(key, { value: valueMap, init: initMap });
};

export const arrDeleteIndex = (name, index) => {
  const key = String(name ?? '');
  if (!key) return;
  const idxKey = normalizeIndexKey(index);
  const prev = arrays.get(key);
  if (!prev) return;
  const valueMap = prev?.value instanceof Map ? prev.value : new Map();
  const initMap = prev?.init instanceof Map ? prev.init : new Map();
  valueMap.delete(idxKey);
  initMap.delete(idxKey);
  arrays.set(key, { value: valueMap, init: initMap });
};

export const arrChange = (name, index, delta) => {
  const cur = arrGet(name, index);
  arrSet(name, index, cur + normalizeNumber(delta, 0));
};

export const arrSize = (name) => {
  const key = String(name ?? '');
  if (!key) return 0;
  const entry = arrays.get(key);
  return entry?.value instanceof Map ? entry.value.size : 0;
};

export const arrExport = () => {
  const out = {};
  for (const [k, v] of arrays.entries()) {
    const valueObj = v?.value instanceof Map ? Object.fromEntries(v.value.entries()) : {};
    const initObj = v?.init instanceof Map ? Object.fromEntries(v.init.entries()) : {};
    out[k] = { value: valueObj, init: initObj };
  }
  return out;
};

export const arrImport = (obj) => {
  arrays.clear();
  if (!obj || typeof obj !== 'object') return;
  for (const [k, v] of Object.entries(obj)) {
    const key = String(k ?? '');
    if (!key) continue;
    arrays.set(key, normalizeArrayEntry(v));
  }
};
