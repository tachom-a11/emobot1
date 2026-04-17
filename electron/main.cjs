const electron = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const axios = require('axios');

// 百度ASR token缓存
let baiduTokenCache = null;
let baiduTokenExpire = 0;

const { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, globalShortcut, session } = electron;

// Packaged apps usually don't have NODE_ENV=production, so use Electron's packaged signal.
// Keep explicit env toggles for local debugging.
const isDev = !app.isPackaged || process.env.VITE_DEV_SERVER === 'true' || process.env.ELECTRON_DEV === 'true';

const APP_TITLE = 'JIMU-control';
const formatWindowTitle = (suffix) => {
  const ver = String(app.getVersion?.() || '').trim();
  const prefix = ver ? `${APP_TITLE} ${ver}` : APP_TITLE;
  const s = String(suffix || '').trim();
  return s ? `${prefix} - ${s}` : prefix;
};
let windowTitleSuffix = '';

let jimu = null;
let JimuBleClient = null;
let winRef = null;
let currentProjectId = null;
const projectRunLogPathById = new Map(); // projectId -> filePath (current app run)

const clampByte = (v) => Math.max(0, Math.min(255, Math.round(v ?? 0)));
const toDataUrlPng = (buf) => `data:image/png;base64,${Buffer.from(buf).toString('base64')}`;
const safeName = (name) =>
  String(name || '')
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 64) || 'Project';

// In packaged builds `app.getAppPath()` points inside app.asar (read-only), so project saves must live in a writable folder.
// Keep the legacy `./jimu_saves` behavior for dev, but use Electron's per-app userData in production.
const getSavesRoot = () => (isDev ? path.join(app.getAppPath(), 'jimu_saves') : path.join(app.getPath('userData'), 'jimu_saves'));
const getProjectDir = (projectId) => path.join(getSavesRoot(), projectId);
const getRoutinesDir = (projectId) => path.join(getProjectDir(projectId), 'routines');
const getRoutinePath = (projectId, routineId) => path.join(getRoutinesDir(projectId), `${routineId}.xml`);
const getActionsDir = (projectId) => path.join(getProjectDir(projectId), 'actions');
const getActionPath = (projectId, actionId) => path.join(getActionsDir(projectId), `${actionId}.json`);
const getLogsDir = (projectId) => path.join(getProjectDir(projectId), 'log');

const defaultRoutineXml = () => '<xml xmlns="https://developers.google.com/blockly/xml"></xml>\n';
const newId = () => {
  try {
    return crypto.randomUUID();
  } catch (_) {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
};

const ensureDir = async (dir) => {
  await fs.mkdir(dir, { recursive: true });
};

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, 'utf8'));
const writeJson = async (filePath, obj) => {
  await fs.writeFile(filePath, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
};

const uiLog = (message) => {
  try {
    if (!winRef) return;
    winRef.webContents.send('ui:log', { message: String(message ?? '') });
  } catch (_) {
    // ignore
  }
};

const formatRunStamp = (d = new Date()) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
};

const ensureProjectRunLog = async (projectId) => {
  if (!projectId) return null;
  if (projectRunLogPathById.has(projectId)) return projectRunLogPathById.get(projectId);
  const dir = getLogsDir(projectId);
  await ensureDir(dir);
  const filePath = path.join(dir, `${formatRunStamp(new Date())}.log`);
  projectRunLogPathById.set(projectId, filePath);
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const logs = entries
      .filter((e) => e.isFile() && e.name.endsWith('.log'))
      .map((e) => e.name)
      .sort((a, b) => b.localeCompare(a));
    const remove = logs.slice(10);
    await Promise.all(remove.map((name) => fs.unlink(path.join(dir, name)).catch(() => {})));
  } catch (_) {
    // ignore
  }
  return filePath;
};

const appendProjectRunLog = async (projectId, line) => {
  if (!projectId) return;
  try {
    const filePath = await ensureProjectRunLog(projectId);
    if (!filePath) return;
    await fs.appendFile(filePath, `${String(line ?? '')}\n`, 'utf8');
  } catch (_) {
    // ignore
  }
};

const backupFile = async (srcPath) => {
  try {
    await fs.copyFile(srcPath, `${srcPath}.bak`);
    return true;
  } catch (e) {
    if (e?.code === 'ENOENT') return false;
    return false;
  }
};

const backupAllRoutineFiles = async (projectId) => {
  if (!projectId) return;
  try {
    await ensureDir(getRoutinesDir(projectId));
    const entries = await fs.readdir(getRoutinesDir(projectId), { withFileTypes: true });
    for (const e of entries) {
      if (!e.isFile()) continue;
      if (!e.name.endsWith('.xml')) continue;
      await backupFile(path.join(getRoutinesDir(projectId), e.name));
    }
  } catch (_) {
    // ignore
  }
};

const backupAllActionFiles = async (projectId) => {
  if (!projectId) return;
  try {
    await ensureDir(getActionsDir(projectId));
    const entries = await fs.readdir(getActionsDir(projectId), { withFileTypes: true });
    for (const e of entries) {
      if (!e.isFile()) continue;
      if (!e.name.endsWith('.json')) continue;
      await backupFile(path.join(getActionsDir(projectId), e.name));
    }
  } catch (_) {
    // ignore
  }
};

const listProjects = async () => {
  const root = getSavesRoot();
  await ensureDir(root);
  const entries = await fs.readdir(root, { withFileTypes: true });
  const folders = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  const results = [];
  for (const id of folders) {
    const projectDir = path.join(root, id);
    const projectJsonPath = path.join(projectDir, 'project.json');
    try {
      const data = await readJson(projectJsonPath);
      let thumbnailDataUrl = null;
      try {
        const thumbPath = path.join(projectDir, 'assets', 'thumbnail.png');
        const buf = await fs.readFile(thumbPath);
        thumbnailDataUrl = toDataUrlPng(buf);
      } catch (_) {
        // ignore
      }
      results.push({
        id,
        name: data?.name || id,
        description: data?.description || '',
        updatedAt: data?.updatedAt || data?.createdAt || null,
        schemaVersion: data?.schemaVersion ?? null,
        thumbnailDataUrl,
      });
    } catch (_) {
      // ignore broken entries
    }
  }
  results.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  return results;
};

const loadProject = async (id) => {
  const root = getSavesRoot();
  const projectDir = path.join(root, id);
  const data = await readJson(path.join(projectDir, 'project.json'));
  let thumbnailDataUrl = null;
  try {
    const buf = await fs.readFile(path.join(projectDir, 'assets', 'thumbnail.png'));
    thumbnailDataUrl = toDataUrlPng(buf);
  } catch (_) {
    // ignore
  }
  return { id, dir: projectDir, data, thumbnailDataUrl };
};

const createProject = async ({ name, description }) => {
  const root = getSavesRoot();
  await ensureDir(root);
  const now = new Date().toISOString();
  const id = `${Date.now()}-${safeName(name).toLowerCase().replace(/\s+/g, '-')}`;
  const projectDir = path.join(root, id);
  await ensureDir(projectDir);
  await ensureDir(path.join(projectDir, 'assets'));
  await ensureDir(path.join(projectDir, 'routines'));
  await ensureDir(path.join(projectDir, 'actions'));
  const data = {
    schemaVersion: 1,
    name: safeName(name),
    description: String(description || ''),
    createdAt: now,
    updatedAt: now,
    hardware: {
      connectedBrick: null,
      firmware: null,
      modules: null,
    },
    calibration: {
      servoConfig: {},
      motorConfig: {},
    },
    routines: [],
    actions: [],
  };
  await writeJson(path.join(projectDir, 'project.json'), data);
  return loadProject(id);
};

const saveProject = async ({ id, data }) => {
  const root = getSavesRoot();
  const projectDir = path.join(root, id);
  await ensureDir(projectDir);
  await ensureDir(path.join(projectDir, 'assets'));
  await ensureDir(path.join(projectDir, 'routines'));
  await ensureDir(path.join(projectDir, 'actions'));
  const now = new Date().toISOString();

  // Always create a per-save backup of every routine XML present on disk.
  // This protects against any accidental write/wipe while we keep a RAM-first model.
  await backupAllRoutineFiles(id);
  await backupAllActionFiles(id);

  // Preserve routines from disk when the UI doesn't provide them.
  // (Older UI paths managed routines via `routine:*` IPC calls only.)
  let preservedRoutines = null;
  let preservedActions = null;
  try {
    const existing = await readJson(path.join(projectDir, 'project.json'));
    if (Array.isArray(existing?.routines)) preservedRoutines = existing.routines;
    if (Array.isArray(existing?.actions)) preservedActions = existing.actions;
  } catch (_) {
    // ignore (project.json may not exist yet)
  }

  const routineXmlById = data && typeof data === 'object' ? data.__routineXmlById : null;
  const routineXmlProvided =
    routineXmlById && typeof routineXmlById === 'object' && Object.keys(routineXmlById).length > 0;
  const actionJsonById = data && typeof data === 'object' ? data.__actionJsonById : null;
  const actionJsonProvided =
    actionJsonById && typeof actionJsonById === 'object' && Object.keys(actionJsonById).length > 0;
  const next = { ...(data || {}), updatedAt: now };
  delete next.__routineXmlById;
  delete next.__actionJsonById;
  if (!Array.isArray(next.routines) && preservedRoutines) next.routines = preservedRoutines;
  if (!Array.isArray(next.actions) && preservedActions) next.actions = preservedActions;
  if (Array.isArray(next.routines) && next.routines.length === 0 && preservedRoutines?.length && !routineXmlProvided) {
    // Safety: prevent accidental wipe if UI sends an empty list without the routine XML batch.
    next.routines = preservedRoutines;
  }
  if (Array.isArray(next.routines) && next.routines.length === 0 && preservedRoutines?.length && routineXmlProvided) {
    // Even if the UI provides some routine XML, an empty list is treated as unsafe by default.
    // Prefer preserving routines rather than risking a full wipe.
    const msg = `Safety: refusing to save empty routines list (preserving ${preservedRoutines.length})`;
    uiLog(msg);
    appendProjectRunLog(id, msg);
    next.routines = preservedRoutines;
  }
  if (Array.isArray(next.actions) && next.actions.length === 0 && preservedActions?.length && !actionJsonProvided) {
    next.actions = preservedActions;
  }
  if (Array.isArray(next.actions) && next.actions.length === 0 && preservedActions?.length && actionJsonProvided) {
    const msg = `Safety: refusing to save empty actions list (preserving ${preservedActions.length})`;
    uiLog(msg);
    appendProjectRunLog(id, msg);
    next.actions = preservedActions;
  }
  if (!next.createdAt) next.createdAt = now;
  if (!next.schemaVersion) next.schemaVersion = 1;

  // If the UI provides routines + their XML, persist them as a batch.
  // This matches the "RAM-first" model: routines are edited in RAM and only
  // written to disk on Project Save.
  if (Array.isArray(next.routines) && routineXmlProvided) {
    const keepIds = new Set(next.routines.map((r) => String(r?.id || '')).filter(Boolean));
    await ensureDir(getRoutinesDir(id));
    let allRoutineXmlPresent = true;

    for (const rid of keepIds) {
      if (!Object.prototype.hasOwnProperty.call(routineXmlById, rid) || routineXmlById[rid] == null) {
        const msg = `Routine XML missing for id=${rid}; preserving existing file`;
        uiLog(msg);
        appendProjectRunLog(id, msg);
        allRoutineXmlPresent = false;
        continue;
      }
      const body = String(routineXmlById[rid] || defaultRoutineXml());
      const routinePath = getRoutinePath(id, rid);
      await backupFile(routinePath);
      await fs.writeFile(routinePath, body, 'utf8');
      const bytes = Buffer.byteLength(body, 'utf8');
      const msg = `Routine saved to disk id=${rid} bytes=${bytes} (project save)`;
      uiLog(msg);
      appendProjectRunLog(id, msg);
    }

    // Delete routine XML files that are no longer referenced by project.json.
    try {
      if (keepIds.size === 0) {
        const msg = 'Safety: skipping routine file pruning because keepIds is empty';
        uiLog(msg);
        appendProjectRunLog(id, msg);
      } else if (!allRoutineXmlPresent) {
        const msg = 'Safety: skipping routine file pruning because routine XML batch is incomplete';
        uiLog(msg);
        appendProjectRunLog(id, msg);
      } else {
        const entries = await fs.readdir(getRoutinesDir(id), { withFileTypes: true });
        for (const e of entries) {
          if (!e.isFile()) continue;
          if (!e.name.endsWith('.xml')) continue;
          const rid = e.name.slice(0, -4);
          if (!keepIds.has(String(rid))) {
            await backupFile(getRoutinePath(id, rid));
            await fs.rm(getRoutinePath(id, rid), { force: true });
          }
        }
      }
    } catch (_) {
      // ignore
    }
  }

  // If the UI provides actions + their JSON, persist them as a batch.
  if (Array.isArray(next.actions) && actionJsonProvided) {
    const keepIds = new Set(next.actions.map((a) => String(a?.id || '')).filter(Boolean));
    await ensureDir(getActionsDir(id));
    let allActionJsonPresent = true;

    for (const aid of keepIds) {
      if (!Object.prototype.hasOwnProperty.call(actionJsonById, aid) || actionJsonById[aid] == null) {
        const msg = `Action JSON missing for id=${aid}; preserving existing file`;
        uiLog(msg);
        appendProjectRunLog(id, msg);
        allActionJsonPresent = false;
        continue;
      }
      const obj = actionJsonById[aid];
      const body = `${JSON.stringify(obj, null, 2)}\n`;
      const actionPath = getActionPath(id, aid);
      await backupFile(actionPath);
      await fs.writeFile(actionPath, body, 'utf8');
      const bytes = Buffer.byteLength(body, 'utf8');
      const msg = `Action saved to disk id=${aid} bytes=${bytes} (project save)`;
      uiLog(msg);
      appendProjectRunLog(id, msg);
    }

    // Delete action JSON files that are no longer referenced by project.json.
    try {
      if (keepIds.size === 0) {
        const msg = 'Safety: skipping action file pruning because keepIds is empty';
        uiLog(msg);
        appendProjectRunLog(id, msg);
      } else if (!allActionJsonPresent) {
        const msg = 'Safety: skipping action file pruning because action JSON batch is incomplete';
        uiLog(msg);
        appendProjectRunLog(id, msg);
      } else {
        const entries = await fs.readdir(getActionsDir(id), { withFileTypes: true });
        for (const e of entries) {
          if (!e.isFile()) continue;
          if (!e.name.endsWith('.json')) continue;
          const aid = e.name.slice(0, -5);
          if (!keepIds.has(String(aid))) {
            await backupFile(getActionPath(id, aid));
            await fs.rm(getActionPath(id, aid), { force: true });
          }
        }
      }
    } catch (_) {
      // ignore
    }
  }

  await writeJson(path.join(projectDir, 'project.json'), next);
  return loadProject(id);
};

const listRoutines = async (projectId) => {
  const data = await readJson(path.join(getProjectDir(projectId), 'project.json'));
  const routines = Array.isArray(data?.routines) ? data.routines : [];
  return routines.map((r) => ({
    id: String(r?.id || ''),
    name: String(r?.name || ''),
    createdAt: r?.createdAt || null,
    updatedAt: r?.updatedAt || null,
  }));
};

const loadActionJson = async (projectId, actionId) => {
  if (!projectId) throw new Error('projectId is required');
  if (!actionId) throw new Error('actionId is required');
  const p = getActionPath(projectId, String(actionId));
  try {
    const obj = await readJson(p);
    return { ok: true, json: obj };
  } catch (e) {
    if (e?.code === 'ENOENT') return { ok: false, notFound: true, json: null };
    throw e;
  }
};

const saveRoutineList = async (projectId, updater) => {
  const projectDir = getProjectDir(projectId);
  const projectJson = path.join(projectDir, 'project.json');
  const data = await readJson(projectJson);
  const now = new Date().toISOString();
  const routines = Array.isArray(data?.routines) ? data.routines : [];
  const nextRoutines = updater(routines, now);
  const next = { ...(data || {}), routines: nextRoutines, updatedAt: now };
  await writeJson(projectJson, next);
  return nextRoutines;
};

const createRoutine = async (projectId, { name } = {}) => {
  const id = newId();
  const now = new Date().toISOString();
  const routineName = safeName(name || 'Routine');
  await ensureDir(getRoutinesDir(projectId));
  const body = defaultRoutineXml();
  await fs.writeFile(getRoutinePath(projectId, id), body, 'utf8');
  const bytes = Buffer.byteLength(body, 'utf8');
  const msg = `Routine saved to disk id=${String(id)} bytes=${bytes} (create)`;
  uiLog(msg);
  appendProjectRunLog(projectId, msg);

  const routines = await saveRoutineList(projectId, (prev) => [
    ...(prev || []),
    { id, name: routineName, createdAt: now, updatedAt: now },
  ]);

  return { ok: true, routine: routines.find((r) => String(r.id) === String(id)) || { id, name: routineName } };
};

const renameRoutine = async (projectId, routineId, nextName) => {
  const routineName = safeName(nextName || '');
  if (!routineName) throw new Error('Routine name is required');
  const routines = await saveRoutineList(projectId, (prev, now) => {
    const list = (prev || []).map((r) => ({ ...(r || {}) }));
    const idx = list.findIndex((r) => String(r.id) === String(routineId));
    if (idx < 0) throw new Error('Routine not found');
    if (list.some((r, i) => i !== idx && String(r?.name || '') === routineName)) {
      throw new Error('Routine name must be unique');
    }
    list[idx].name = routineName;
    list[idx].updatedAt = now;
    return list;
  });
  return { ok: true, routine: routines.find((r) => String(r.id) === String(routineId)) || null };
};

const deleteRoutine = async (projectId, routineId) => {
  await saveRoutineList(projectId, (prev) => (prev || []).filter((r) => String(r?.id) !== String(routineId)));
  try {
    await backupFile(getRoutinePath(projectId, routineId));
    await fs.rm(getRoutinePath(projectId, routineId), { force: true });
  } catch (_) {
    // ignore
  }
  return { ok: true };
};

const loadRoutineXml = async (projectId, routineId) => {
  try {
    return await fs.readFile(getRoutinePath(projectId, routineId), 'utf8');
  } catch (_) {
    return defaultRoutineXml();
  }
};

const saveRoutineXml = async (projectId, routineId, xml) => {
  await ensureDir(getRoutinesDir(projectId));
  const body = String(xml || defaultRoutineXml());
  const routinePath = getRoutinePath(projectId, routineId);
  await backupFile(routinePath);
  await fs.writeFile(routinePath, body, 'utf8');
  const bytes = Buffer.byteLength(body, 'utf8');
  const msg = `Routine saved to disk id=${String(routineId)} bytes=${bytes}`;
  uiLog(msg);
  appendProjectRunLog(projectId, msg);
  await saveRoutineList(projectId, (prev, now) =>
    (prev || []).map((r) => (String(r?.id) === String(routineId) ? { ...(r || {}), updatedAt: now } : r)),
  );
  return { ok: true };
};

const cloneProject = async ({ fromId, name, description }) => {
  if (!fromId) throw new Error('fromId is required');
  const src = await loadProject(fromId);
  const created = await createProject({ name, description });
  const nextData = {
    ...(src?.data || {}),
    schemaVersion: src?.data?.schemaVersion ?? 1,
    name: safeName(name),
    description: String(description || ''),
    createdAt: created?.data?.createdAt || new Date().toISOString(),
  };
  await saveProject({ id: created.id, data: nextData });

  // Best-effort: copy routine XML and action JSON files so the cloned project is complete.
  const copyDirByExt = async (fromDir, toDir, ext) => {
    try {
      await ensureDir(toDir);
      const entries = await fs.readdir(fromDir, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isFile()) continue;
        if (ext && !e.name.endsWith(ext)) continue;
        await fs.copyFile(path.join(fromDir, e.name), path.join(toDir, e.name));
      }
    } catch (_) {
      // ignore
    }
  };
  await copyDirByExt(getRoutinesDir(fromId), getRoutinesDir(created.id), '.xml');
  await copyDirByExt(getActionsDir(fromId), getActionsDir(created.id), '.json');
  try {
    await fs.copyFile(
      path.join(src.dir, 'assets', 'thumbnail.png'),
      path.join(created.dir, 'assets', 'thumbnail.png'),
    );
  } catch (_) {
    // ignore if no thumbnail
  }
  return loadProject(created.id);
};

const createWindow = async () => {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      // ✅ 修复语音识别必须的配置
      webSecurity: false,
      allowRunningInsecureContent: true,
      webviewTag: true
    },
    title: formatWindowTitle(),
  });
  winRef = win;
  windowTitleSuffix = '';

  win.on('page-title-updated', (e) => {
    e.preventDefault();
    if (winRef && !winRef.isDestroyed()) winRef.setTitle(formatWindowTitle(windowTitleSuffix));
  });

  // 在开发模式下默认打开开发者工具
  if (isDev) {
    win.webContents.once('did-finish-load', () => {
      try {
        win.webContents.openDevTools({ mode: 'detach' });
      } catch (_) {}
    });
  }

  // ✅ 必须添加：启用媒体权限（麦克风）
  win.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    if (
      permission === 'media' ||
      permission === 'microphone' ||
      permission === 'audioCapture'
    ) {
      callback(true);
    } else {
      callback(false);
    }
  });

  if (isDev) {
    await win.loadURL('http://localhost:5173');
  } else {
    const indexPath = path.join(app.getAppPath(), 'dist', 'index.html');
    await win.loadFile(indexPath);
  }
  
  win.webContents.on('did-finish-load', () => {
    console.log("页面加载完成");
  });
};

const sendToRenderer = (channel, payload) => {
  if (winRef && !winRef.isDestroyed()) {
    winRef.webContents.send(channel, payload);
  }
};

const attachJimuEvents = () => {
  jimu.on('status', (status) => sendToRenderer('jimu:status', status));
  jimu.on('battery', (battery) => sendToRenderer('jimu:battery', battery));
  jimu.on('disconnect', () => sendToRenderer('jimu:disconnected'));
  jimu.on('servoPosition', (pos) => sendToRenderer('jimu:servoPos', pos));
  jimu.on('tx', (frame) => sendToRenderer('jimu:tx', frame));
  jimu.on('frame', (frame) => sendToRenderer('jimu:frame', frame));
  jimu.on('sendQueue', (stats) => sendToRenderer('jimu:sendQueue', stats));
  jimu.on('sensor', (evt) => sendToRenderer('jimu:sensor', evt));
  jimu.on('commandResult', (evt) => sendToRenderer('jimu:commandResult', evt));
  jimu.on('deviceError', (evt) => sendToRenderer('jimu:deviceError', evt));
  jimu.on('errorReport', (evt) => sendToRenderer('jimu:errorReport', evt));
  jimu.on('transportError', (evt) => sendToRenderer('jimu:transportError', evt));
};

const registerIpc = () => {
  ipcMain.handle('project:list', async () => listProjects());
  ipcMain.handle('project:create', async (_evt, { name, description } = {}) => {
    const created = await createProject({ name, description });
    currentProjectId = created?.id || null;
    if (created?.id) projectRunLogPathById.delete(created.id);
    if (created?.id) appendProjectRunLog(created.id, `=== Project created ${new Date().toISOString()} ===`);
    return created;
  });
  ipcMain.handle('project:clone', async (_evt, { fromId, name, description } = {}) => {
    const created = await cloneProject({ fromId, name, description });
    currentProjectId = created?.id || null;
    if (created?.id) projectRunLogPathById.delete(created.id);
    if (created?.id) appendProjectRunLog(created.id, `=== Project cloned ${new Date().toISOString()} ===`);
    return created;
  });
  ipcMain.handle('project:open', async (_evt, { id } = {}) => {
    const opened = await loadProject(id);
    currentProjectId = id || null;
    if (id) projectRunLogPathById.delete(id);
    if (id) appendProjectRunLog(id, `=== Project opened ${new Date().toISOString()} ===`);
    return opened;
  });
  ipcMain.handle('project:save', async (_evt, { id, data } = {}) => saveProject({ id, data }));
  ipcMain.handle('project:delete', async (_evt, { id } = {}) => {
    const root = getSavesRoot();
    const projectDir = path.join(root, id);
    await fs.rm(projectDir, { recursive: true, force: true });
    return { ok: true };
  });
  ipcMain.handle('project:setThumbnail', async (_evt, { id } = {}) => {
    const root = getSavesRoot();
    const projectDir = path.join(root, id);
    await ensureDir(path.join(projectDir, 'assets'));
    const result = await dialog.showOpenDialog(winRef, {
      title: 'Select project thumbnail',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'webp'] }],
    });
    if (result.canceled || !result.filePaths?.length) return { canceled: true };
    const img = nativeImage.createFromPath(result.filePaths[0]);
    const resized = img.resize({ width: 64, height: 64, quality: 'good' });
    const png = resized.toPNG();
    await fs.writeFile(path.join(projectDir, 'assets', 'thumbnail.png'), png);
    return { ok: true, thumbnailDataUrl: toDataUrlPng(png) };
  });

  ipcMain.handle('routine:list', async (_evt, { projectId } = {}) => {
    if (!projectId) throw new Error('projectId is required');
    return listRoutines(projectId);
  });
  ipcMain.handle('action:loadJson', async (_evt, { projectId, actionId } = {}) => {
    return loadActionJson(projectId, actionId);
  });
  ipcMain.handle('routine:create', async (_evt, { projectId, name } = {}) => {
    if (!projectId) throw new Error('projectId is required');
    return createRoutine(projectId, { name });
  });
  ipcMain.handle('routine:rename', async (_evt, { projectId, routineId, name } = {}) => {
    if (!projectId) throw new Error('projectId is required');
    if (!routineId) throw new Error('routineId is required');
    return renameRoutine(projectId, routineId, name);
  });
  ipcMain.handle('routine:delete', async (_evt, { projectId, routineId } = {}) => {
    if (!projectId) throw new Error('projectId is required');
    if (!routineId) throw new Error('routineId is required');
    return deleteRoutine(projectId, routineId);
  });
  ipcMain.handle('routine:loadXml', async (_evt, { projectId, routineId } = {}) => {
    if (!projectId) throw new Error('projectId is required');
    if (!routineId) throw new Error('routineId is required');
    return { ok: true, xml: await loadRoutineXml(projectId, routineId) };
  });
  ipcMain.handle('routine:saveXml', async (_evt, { projectId, routineId, xml } = {}) => {
    if (!projectId) throw new Error('projectId is required');
    if (!routineId) throw new Error('routineId is required');
    return saveRoutineXml(projectId, routineId, xml);
  });

  ipcMain.on('app:log', async (_evt, { projectId, line } = {}) => {
    const pid = projectId || currentProjectId;
    if (!pid || !line) return;
    appendProjectRunLog(pid, String(line));
  });

  ipcMain.handle('jimu:scan', async () => {
    const devices = await JimuBleClient.scan({ timeoutMs: 8000 });
    return devices.map((d) => ({ id: d.id, name: d.name || 'Unknown' }));
  });
  ipcMain.handle('jimu:connect', async (_evt, target) => {
    await jimu.connect(target);
    const info = jimu.getInfo();
    return info;
  });
  ipcMain.handle('jimu:disconnect', async () => {
    await jimu.disconnect();
    sendToRenderer('jimu:disconnected');
  });
  ipcMain.handle('jimu:refreshStatus', async () => {
    return jimu.refreshStatus();
  });
  ipcMain.handle('jimu:changeModuleId', async (_evt, { module, fromId, toId } = {}) => {
    const kind = String(module || '').toLowerCase();
    const safeFrom = Number.isFinite(Number(fromId)) ? Number(fromId) : null;
    const safeTo = Number.isFinite(Number(toId)) ? Number(toId) : null;
    if (!kind) throw new Error('module is required');
    if (safeFrom === null || safeTo === null) throw new Error('fromId/toId must be numbers');

    if (kind === 'servo') {
      if (safeFrom < 0 || safeFrom > 32) throw new Error('servo fromId must be 0..32');
      if (safeTo < 1 || safeTo > 32) throw new Error('servo toId must be 1..32');
      await jimu.changeServoId(safeFrom, safeTo);
      return { ok: true };
    }

    const peripheralTypes = {
      ir: 0x01,
      eye: 0x04,
      ultrasonic: 0x06,
      motor: 0x0a,
      speaker: 0x08,
    };
    const type = peripheralTypes[kind];
    if (!type) throw new Error(`Unknown module type: ${kind}`);
    if (safeFrom < 0 || safeFrom > 8) throw new Error(`${kind} fromId must be 0..8`);
    if (safeTo < 1 || safeTo > 8) throw new Error(`${kind} toId must be 1..8`);
    await jimu.changePeripheralId({ type, fromId: safeFrom, toId: safeTo });
    return { ok: true };
  });
  ipcMain.handle('jimu:enable', async () => {
    return jimu.enableDetected();
  });
  ipcMain.handle('jimu:readSensors', async () => {
    try {
      await jimu.readAllSensors();
      return { ok: true };
    } catch (e) {
      return { error: true, message: e?.message || String(e) };
    }
  });
  ipcMain.handle('jimu:setEyeRed', async () => {
    return jimu.setEyeColor({ eyesMask: 0x01, time: 0xff, r: 0xff, g: 0x00, b: 0x00 });
  });
  ipcMain.handle('jimu:setEyeColor', async (_evt, { eyesMask = 0x01, time = 0xff, r = 0, g = 0, b = 0 } = {}) => {
    return jimu.setEyeColor({
      eyesMask,
      time,
      r: Math.max(0, Math.min(255, Math.round(r))),
      g: Math.max(0, Math.min(255, Math.round(g))),
      b: Math.max(0, Math.min(255, Math.round(b))),
      enqueueOnly: true,
    });
  });
  ipcMain.handle('jimu:setEyeOff', async (_evt, { eyesMask = 0x01 } = {}) => {
    return jimu.setEyeColor({ eyesMask, time: 0x00, r: 0x00, g: 0x00, b: 0x00, enqueueOnly: true });
  });
  ipcMain.handle('jimu:setEyeSegments', async (_evt, { eyesMask = 0x01, time = 0xff, entries = [] } = {}) => {
    const safeEntries = Array.isArray(entries)
      ? entries.map((e) => ({
          r: Math.max(0, Math.min(255, Math.round(e?.r ?? 0))),
          g: Math.max(0, Math.min(255, Math.round(e?.g ?? 0))),
          b: Math.max(0, Math.min(255, Math.round(e?.b ?? 0))),
          mask: Math.max(0, Math.min(255, Math.round(e?.mask ?? 1))),
        }))
      : [];
    return jimu.setEyeSegments({ eyesMask, time, entries: safeEntries, enqueueOnly: true });
  });
  ipcMain.handle('jimu:setEyeAnimation', async (_evt, { eyesMask = 0x01, animationId = 1, repetitions = 1, r = 0, g = 0, b = 0 } = {}) => {
    return jimu.setEyeAnimation({
      eyesMask,
      animationId,
      repetitions,
      r: Math.max(0, Math.min(255, Math.round(r))),
      g: Math.max(0, Math.min(255, Math.round(g))),
      b: Math.max(0, Math.min(255, Math.round(b))),
      enqueueOnly: true,
    });
  });
  ipcMain.handle('jimu:setUltrasonicLed', async (_evt, { id = 1, r = 0, g = 0, b = 0 } = {}) => {
    return jimu.setUltrasonicLed({
      id,
      r: Math.max(0, Math.min(255, Math.round(r))),
      g: Math.max(0, Math.min(255, Math.round(g))),
      b: Math.max(0, Math.min(255, Math.round(b))),
      enqueueOnly: true,
    });
  });
  ipcMain.handle('jimu:setUltrasonicLedOff', async (_evt, { id = 1 } = {}) => {
    return jimu.setUltrasonicLedOff(id, { enqueueOnly: true });
  });
  ipcMain.handle('jimu:readServo', async (_evt, id) => jimu.readServoPosition(id));
  ipcMain.handle('jimu:readSensorIR', async (_evt, id) => {
    try {
      return await jimu.readIR(id);
    } catch (e) {
      return { error: true, message: e?.message || String(e) };
    }
  });
  ipcMain.handle('jimu:readSensorUS', async (_evt, id) => {
    try {
      return await jimu.readUltrasonic(id);
    } catch (e) {
      return { error: true, message: e?.message || String(e) };
    }
  });
  ipcMain.handle('ui:setTitle', (_evt, title) => {
    if (!winRef || winRef.isDestroyed()) return;
    const raw = String(title || '').trim();
    const stripped = raw.replace(/^jimu[- ]?control(\s*\d+\.\d+\.\d+)?\s*[-–—:]?\s*/i, '');
    windowTitleSuffix = String(stripped || '').trim();
    winRef.setTitle(formatWindowTitle(windowTitleSuffix));
  });
  ipcMain.handle('jimu:setServoPos', async (_evt, { id, posDeg, speed }) => {
    return jimu.setServoPositionDeg(id, posDeg ?? 0, { speed: speed ?? 0x14, tail: [0x00, 0x00], enqueueOnly: true });
  });
  ipcMain.handle('jimu:setServoPosMulti', async (_evt, { ids, degrees, speed }) => {
    return jimu.setServoPositionsDeg({
      ids: Array.isArray(ids) ? ids : [],
      degrees: Array.isArray(degrees) ? degrees : [],
      speed: speed ?? 0x14,
      tail: [0x00, 0x00],
      enqueueOnly: true,
    });
  });
  ipcMain.handle('jimu:rotateServo', async (_evt, { id, dir, speed, maxSpeed = 1000 }) => {
    const lim = Math.max(0, Math.min(maxSpeed, speed ?? 0));
    return jimu.rotateServo(id, dir, lim, { enqueueOnly: true });
  });
  ipcMain.handle('jimu:rotateServoMulti', async (_evt, { ids, dir, speed, maxSpeed = 1000 }) => {
    const lim = Math.max(0, Math.min(maxSpeed, speed ?? 0));
    const list = Array.isArray(ids) ? ids : [];
    return jimu.rotateServos(list, dir, lim, { enqueueOnly: true });
  });
  ipcMain.handle('jimu:rotateMotor', async (_evt, { id, dir = 'cw', speed = 0, maxSpeed = 150, durationMs = 1000 }) => {
    const lim = Math.max(0, Math.min(maxSpeed, Math.round(speed ?? 0)));
    const signed = dir === 'ccw' ? -lim : lim;
    return jimu.rotateMotor(id, signed, Math.max(0, Math.min(6000, Math.round(durationMs ?? 1000))), { enqueueOnly: true });
  });
  ipcMain.handle('jimu:rotateMotorSigned', async (_evt, { id, speed = 0, maxSpeed = 150, durationMs = 1000 }) => {
    const raw = Math.round(Number(speed ?? 0));
    const lim = Math.max(0, Math.min(maxSpeed, Math.abs(raw)));
    const signed = raw < 0 ? -lim : lim;
    return jimu.rotateMotor(Number(id ?? 0), signed, Math.max(0, Math.min(6000, Math.round(durationMs ?? 1000))), { enqueueOnly: true });
  });
  ipcMain.handle('jimu:stopMotor', async (_evt, id) => jimu.stopMotor(id));
  ipcMain.handle('jimu:emergencyStop', async () => jimu.emergencyStop());

  // 获取百度ASR token（带缓存）
  const getBaiduToken = async () => {
    const API_KEY = "Zi9hq61cakccTxoEY5E41YlD";
    const SECRET_KEY = "SBdzTIoSBXzhsuA67ZprO02HJpxJlvpr";

    // 检查缓存是否有效
    if (baiduTokenCache && Date.now() < baiduTokenExpire) {
      console.log("✅ 使用缓存的百度token");
      return baiduTokenCache;
    }

    // 获取新token
    const tokenRes = await axios.get('https://aip.baidubce.com/oauth/2.0/token', {
      params: {
        grant_type: 'client_credentials',
        client_id: API_KEY,
        client_secret: SECRET_KEY
      }
    });

    baiduTokenCache = tokenRes.data.access_token;
    // 设置过期时间为25分钟（比实际过期时间少5分钟）
    baiduTokenExpire = Date.now() + 25 * 60 * 1000;
    console.log("✅ 获取新的百度token");

    return baiduTokenCache;
  };

  // 处理百度语音识别事件
  ipcMain.handle('baidu:asr', async (event, { base64 }) => {
    try {
      // 获取token（带缓存）
      const token = await getBaiduToken();

      const audioBuffer = Buffer.from(base64, 'base64');

      // 百度语音识别（完整长语音模式）
      const res = await axios({
        method: 'post',
        url: 'https://vop.baidu.com/server_api',
        headers: { 'Content-Type': 'application/json' },
        data: {
          format: 'pcm',
          rate: 16000,
          channel: 1,
          cuid: 'robot_device',
          token: token,
          speech: base64,
          len: audioBuffer.length,
          dev_pid: 1537,       // 普通话
          lan: 'zh',
          max_results: 1,      // 只返回一条最准确结果
        }
      });
      console.log("✅ 百度返回", res.data);

      return res.data;
    } catch (err) {
      console.error('百度识别错误：', err);
      return { result: [] };
    }
  });

  // 处理LLM语义理解
  ipcMain.handle('llm:parse', async (event, text) => {
    try {
      const res = await axios.post(
        'https://yunwu.ai/v1/chat/completions',
        {
          model: "gpt-5-mini",
          messages: [
            {
              role: "system",
              content: `
你是一个机器人控制器，请将用户语音解析为JSON指令。

只允许返回以下格式：
{
  "intent": "emotion|move|stop|chat",
  "action": "happy|sad|forward|backward|left|right|stop|null",
  "reply": "给用户的自然语言回复"
}

如果无法识别，intent=chat
`
            },
            {
              role: "user",
              content: text
            }
          ],
          temperature: 0.3
        },
        {
          headers: {
            Authorization: "Bearer sk-RG2GpS76qna2Fgo3qO2apR0ComVKkDCDOWTwANVnwV0D8upB",
            "Content-Type": "application/json"
          }
        }
      );

      return res.data;
    } catch (err) {
      console.error("LLM错误:", err.response?.data || err.message);
      return null;
    }
  });
};

const buildMenu = () => {
  Menu.setApplicationMenu(null);
};

const main = async () => {
  const { Jimu } = await import(pathToFileURL(path.join(__dirname, '..', 'jimu', 'jimu.js')).href);
  const ble = await import(pathToFileURL(path.join(__dirname, '..', 'jimu', 'jimu_ble.js')).href);
  JimuBleClient = ble.JimuBleClient;
  jimu = new Jimu();

  attachJimuEvents();
  registerIpc();
  buildMenu();

  await app.whenReady();

  // ✅ 关键：麦克风权限
  session.defaultSession.setPermissionRequestHandler(
    (webContents, permission, callback) => {
      if (permission === 'media') {
        callback(true);
      } else {
        callback(false);
      }
    }
  );

  await createWindow();

  if (isDev || process.env.JIMU_OPEN_DEVTOOLS === '1') {
    try {
      globalShortcut.register('CommandOrControl+Shift+I', () => {
        if (!winRef || winRef.isDestroyed()) return;
        winRef.webContents.toggleDevTools();
      });
    } catch (_) {
      // ignore
    }
  }

  app.on('will-quit', () => {
    try {
      globalShortcut.unregisterAll();
    } catch (_) {
      // ignore
    }
  });
};

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal error in Electron main:', err);
  try {
    electron?.app?.quit?.();
  } catch (_) {
    // ignore
  }
});
