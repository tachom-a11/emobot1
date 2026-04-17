import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import * as Slider from '@radix-ui/react-slider';
import RoutinesTab from './routines/RoutinesTab.jsx';
import RemoteControlTab from './routines/RemoteControlTab.jsx';
import VoiceRecognitionTab from './routines/VoiceRecognitionTab.jsx';

console.log("App.jsx 加载了");
import { batteryPercentFromVolts } from './battery.js';
import * as globalVars from './routines/global_vars.js';
import servoIconUrl from '../media/servo-icon.png';
import wheelIconUrl from '../media/wheel-icon.png';

const EMPTY_CONTROLLER = { widgets: [] };

const Section = ({ title, children, style, className = '' }) => (
  <div className={`section-shell ${className}`.trim()} style={{ 
    border: '1px solid var(--border-color)', 
    borderRadius: 'var(--border-radius)', 
    padding: 16, 
    marginBottom: 16, 
    backgroundColor: 'var(--card-background)',
    boxShadow: 'var(--shadow-md)',
    transition: 'var(--transition)',
    ...(style || {})
  }}>
    {title ? <h2 style={{ margin: '0 0 12px 0', color: 'var(--text-primary)', fontSize: 18, fontWeight: 600 }}>{title}</h2> : null}
    {children}
  </div>
);

const TechIcon = ({ children }) => (
  <span
    aria-hidden="true"
    style={{
      width: 18,
      height: 18,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'currentColor',
      flexShrink: 0,
    }}
  >
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7">
      {children}
    </svg>
  </span>
);

const CubeIcon = () => (
  <TechIcon>
    <path d="M12 3 4.5 7v10L12 21l7.5-4V7L12 3Z" />
    <path d="M12 3v18" />
    <path d="m4.5 7 7.5 4 7.5-4" />
  </TechIcon>
);

const PulseIcon = () => (
  <TechIcon>
    <path d="M3 12h4l2-4 4 8 2-4h6" />
  </TechIcon>
);

const SignalIcon = () => (
  <TechIcon>
    <path d="M4 18h16" />
    <path d="M7 15a5 5 0 0 1 10 0" />
    <path d="M10 12a2 2 0 0 1 4 0" />
  </TechIcon>
);

const MicIcon = () => (
  <TechIcon>
    <rect x="9" y="3" width="6" height="11" />
    <path d="M6 11a6 6 0 0 0 12 0" />
    <path d="M12 17v4" />
  </TechIcon>
);

const RemoteIcon = () => (
  <TechIcon>
    <rect x="8" y="3" width="8" height="18" />
    <circle cx="12" cy="16" r="1.2" fill="currentColor" stroke="none" />
    <path d="M10 7h4M10 10h4" />
  </TechIcon>
);

const PlaceholderList = ({ items }) => (
  <ul style={{ margin: 0, paddingLeft: 18 }}>
    {items.map((item, idx) => (
      <li key={`${idx}-${String(item)}`}>{item}</li>
    ))}
  </ul>
);

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clampByte = (v) => Math.max(0, Math.min(255, Math.round(v ?? 0)));
const uniqSortedNums = (arr) =>
  Array.from(new Set((Array.isArray(arr) ? arr : []).map((x) => Number(x)).filter((x) => Number.isFinite(x)))).sort(
    (a, b) => a - b,
  );
const getModuleStatusKind = (id, savedIds, liveIds, { connected = true } = {}) => {
  if (!connected) return 'offline';
  const isSaved = (savedIds || []).includes(id);
  const isLive = (liveIds || []).includes(id);
  if (isLive && isSaved) return 'detected';
  if (isLive && !isSaved) return 'new';
  if (!isLive && isSaved) return 'missing';
  return 'missing';
};
const moduleStatusColor = (kind) => {
  if (kind === 'detected') return 'var(--secondary-color)';
  if (kind === 'new') return 'var(--primary-color)';
  if (kind === 'error') return '#ef4444';
  if (kind === 'offline') return '#94a3b8';
  return '#94a3b8';
};
const moduleStatusBg = (kind) => {
  if (kind === 'detected') return '#d1fae5';
  if (kind === 'new') return '#dbeafe';
  if (kind === 'error') return '#fee2e2';
  if (kind === 'offline') return '#f1f5f9';
  return '#f1f5f9';
};
const moduleButtonStyle = (kind, isLive) => {
  const bg = moduleStatusColor(kind);
  return {
    padding: '8px 12px',
    background: bg,
    color: '#fff',
    border: `1px solid ${bg}`,
    borderRadius: 'var(--border-radius)',
    opacity: isLive ? 1 : 0.65,
    cursor: isLive ? 'pointer' : 'not-allowed',
    transition: 'var(--transition)',
    boxShadow: 'var(--shadow-sm)',
  };
};
const moduleBadgeStyle = (kind) => {
  const c = moduleStatusColor(kind);
  return {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '4px 10px',
    borderRadius: 'var(--border-radius)',
    border: `1px solid ${c}`,
    background: moduleStatusBg(kind),
    color: 'var(--text-primary)',
    fontSize: 12,
    fontWeight: 600,
    transition: 'var(--transition)',
  };
};
const rgbToHex = (r, g, b) =>
  `#${[r, g, b]
    .map((x) => clampByte(x).toString(16).padStart(2, '0'))
    .join('')}`;
const hexToRgb = (hex) => {
  const s = String(hex || '').replace('#', '').trim();
  if (s.length !== 6) return null;
  const r = parseInt(s.slice(0, 2), 16);
  const g = parseInt(s.slice(2, 4), 16);
  const b = parseInt(s.slice(4, 6), 16);
  if ([r, g, b].some((x) => Number.isNaN(x))) return null;
  return { r, g, b };
};

const BatteryIcon = ({ volts, connected }) => {
  const pct = batteryPercentFromVolts(volts);
  const fillPct = connected && pct != null ? pct : 0;
  const label = 
    connected && pct != null
      ? `${volts.toFixed(2)}V (${Math.round(pct * 100)}%)`
      : '未连接';
  const frameBg = connected ? 'var(--card-background)' : '#f1f1f1';
  const frameBorder = connected ? 'var(--border-color)' : '#d1d5db';
  const fillColor = connected ? (pct != null && pct < 0.1 ? '#ef4444' : 'var(--secondary-color)') : '#94a3b8';

  return (
    <div title={label} style={{ display: 'flex', justifyContent: 'flex-end' }}>
      <div
        style={{
          position: 'relative',
          width: 88,
          height: 24,
          boxSizing: 'border-box',
          borderRadius: 6,
          border: `1px solid ${frameBorder}`,
          background: frameBg,
          padding: 4,
          boxShadow: 'var(--shadow-sm)',
          transition: 'var(--transition)'
        }}
      >
        <div
          style={{
            position: 'absolute',
            right: -6,
            top: 8,
            width: 6,
            height: 8,
            borderRadius: '0 3px 3px 0',
            borderStyle: 'solid',
            borderColor: frameBorder,
            borderWidth: 1,
            borderLeftWidth: 0,
            background: frameBg,
            boxSizing: 'border-box',
          }}
        />
        <div
          style={{
            height: '100%',
            width: `${Math.round(fillPct * 100)}%`,
            background: fillColor,
            borderRadius: 4,
            transition: 'width 120ms linear',
            boxShadow: 'inset 0 1px 2px rgba(0, 0, 0, 0.1)'
          }}
        />
      </div>
    </div>
  );
};

const TouchBarSlider = ({
  minLimit = -120,
  maxLimit = 120,
  minValue,
  maxValue,
  value,
  onChange,
}) => {
  const [activeThumb, setActiveThumb] = useState(null);
  const safeMin = clamp(minValue, minLimit, 119);
  const safeMax = clamp(maxValue, safeMin + 1, maxLimit);
  const safeValue = clamp(value, safeMin, safeMax);
  const values = [safeMin, safeValue, safeMax];

  return (
    <div style={{ marginTop: 6 }}>
      <Slider.Root
        className="touchbar-slider"
        min={minLimit}
        max={maxLimit}
        step={1}
        value={values}
        onValueChange={(next) => {
          if (!next || next.length !== 3) return;
          if (activeThumb === 0) {
            const nextMin = clamp(next[0], minLimit, safeMax - 1);
            const nextVal = clamp(safeValue, nextMin, safeMax);
            onChange({ min: nextMin, max: safeMax, value: nextVal });
            return;
          }
          if (activeThumb === 2) {
            const nextMax = clamp(next[2], safeMin + 1, maxLimit);
            const nextVal = clamp(safeValue, safeMin, nextMax);
            onChange({ min: safeMin, max: nextMax, value: nextVal });
            return;
          }
          const nextVal = clamp(next[1], safeMin, safeMax);
          onChange({ min: safeMin, max: safeMax, value: nextVal });
        }}
      >
        <Slider.Track className="touchbar-track">
          <Slider.Range className="touchbar-range" />
        </Slider.Track>
        <Slider.Thumb
          className="touchbar-thumb touchbar-thumb-min"
          aria-label="min position"
          onPointerDown={() => setActiveThumb(0)}
          onPointerUp={() => setActiveThumb(null)}
          onFocus={() => setActiveThumb(0)}
          onBlur={() => setActiveThumb(null)}
        />
        <Slider.Thumb
          className="touchbar-thumb touchbar-thumb-value"
          aria-label="test position"
          onPointerDown={() => setActiveThumb(1)}
          onPointerUp={() => setActiveThumb(null)}
          onFocus={() => setActiveThumb(1)}
          onBlur={() => setActiveThumb(null)}
        />
        <Slider.Thumb
          className="touchbar-thumb touchbar-thumb-max"
          aria-label="max position"
          onPointerDown={() => setActiveThumb(2)}
          onPointerUp={() => setActiveThumb(null)}
          onFocus={() => setActiveThumb(2)}
          onBlur={() => setActiveThumb(null)}
        />
      </Slider.Root>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#666' }}>
        <span>{minLimit}</span>
        <span>{maxLimit}</span>
      </div>
    </div>
  );
};

export default function App() {
  const [status, setStatus] = useState('Disconnected');
  const [modules, setModules] = useState(null);
  const [battery, setBattery] = useState(null);
  const [log, setLog] = useState([]);
  const [projects, setProjects] = useState([]);
  const [currentProject, setCurrentProject] = useState(null);
  const [isDirty, setIsDirty] = useState(false);
  const [bricks, setBricks] = useState([]);
  const [selectedBrickId, setSelectedBrickId] = useState('');
  const [tab, setTab] = useState('model'); // model | routines
  const [initialModules, setInitialModules] = useState(null);
  const [servoDetail, setServoDetail] = useState(null);
  const [motorDetail, setMotorDetail] = useState(null);
  const [eyeDetail, setEyeDetail] = useState(null);
  const [irPanel, setIrPanel] = useState({ open: false, live: false });
  const [usPanel, setUsPanel] = useState({
    open: false,
    live: false,
    led: { id: 1, hex: '#00ff00', r: 0, g: 255, b: 0 },
  });
  const [sensorReadings, setSensorReadings] = useState({ ir: {}, us: {} });
  const [sensorError, setSensorError] = useState(null);
  const [isScanning, setIsScanning] = useState(false);
  const [verboseFrames, setVerboseFrames] = useState(false);
  const [idChange, setIdChange] = useState({ module: 'servo', fromId: 0, toId: 1 });
  const [idChangeError, setIdChangeError] = useState(null);
  const [isChangingId, setIsChangingId] = useState(false);
  const [idChangeOpen, setIdChangeOpen] = useState(false);
  const [projectDialog, setProjectDialog] = useState({
    open: false,
    mode: 'new',
    name: '',
    description: '',
  });
  const ipc = useMemo(() => {
    try {
      if (typeof window?.require !== 'function') return null;
      const electronApi = window.require('electron');
      return electronApi?.ipcRenderer || null;
    } catch (_) {
      return null;
    }
  }, []);
  const eyeAnimCancelRef = useRef(null);
  const routinesRef = useRef(null);
  const voiceRef = useRef(null);
  const controlRef = useRef(null);
  const routineXmlRamCacheRef = useRef(new Map());

  const addLog = useCallback((msg, opts = {}) => {
    const persist = opts?.persist !== false;
    const line = `${new Date().toLocaleTimeString()} ${msg}`;
    setLog((prev) => [line, ...prev].slice(0, 200));
    try {
      if (persist && ipc && currentProject?.id) ipc.send?.('app:log', { projectId: currentProject.id, line });
    } catch (_) {
    }
  }, [ipc, currentProject?.id]);

  const payloadToHex = (payload) => {
    if (!payload) return '';
    const bytes = Array.from(payload);
    return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
  };

  const firmware = useMemo(() => modules?.text || '无', [modules]);
  const listMask = (arr) => (arr && arr.length ? arr.join(', ') : 'none');
  const hasProject = Boolean(currentProject?.id);
  const isConnected = status === 'Connected';
  const statusLabel =
    status === 'Connected' ? '已连接' : status === 'Disconnected' ? '未连接' : status === 'Error' ? '错误' : status;
  const statusTone =
    status === 'Connected'
      ? 'var(--secondary-color)'
      : status === 'Error'
        ? 'var(--error-color)'
        : 'var(--text-secondary)';
  const liveModuleCount =
    (modules?.servos?.length || 0) +
    (modules?.motors?.length || 0) +
    (modules?.ir?.length || 0) +
    (modules?.ultrasonic?.length || 0) +
    (modules?.eyes?.length || 0) +
    (modules?.speakers?.length || 0);
  const projectSummary = currentProject?.data?.description || '用于管理硬件映射、情绪识别流程与实时控制。';
  const tabItems = [
    { key: 'model', label: '调试台', icon: <SignalIcon /> },
    { key: 'routines', label: '情绪识别', icon: <PulseIcon /> },
    { key: 'voice', label: '语音识别', icon: <MicIcon /> },
    { key: 'control', label: '遥控器', icon: <RemoteIcon /> },
  ];
  const idChangeMax = idChange.module === 'servo' ? 32 : 8;
  const idChangeDetectedIds = useMemo(() => {
    const kind = String(idChange.module || '').toLowerCase();
    const map = {
      servo: modules?.servos,
      motor: modules?.motors,
      ir: modules?.ir,
      ultrasonic: modules?.ultrasonic,
      eye: modules?.eyes,
      speaker: modules?.speakers,
    };
    const raw = map[kind] || [];
    return Array.from(new Set((Array.isArray(raw) ? raw : []).map(Number).filter((n) => Number.isFinite(n) && n > 0))).sort(
      (a, b) => a - b,
    );
  }, [modules, idChange.module]);
  const idChangeFromOptions = useMemo(() => [0, ...idChangeDetectedIds], [idChangeDetectedIds]);
  const updateCurrentProjectData = useCallback((updater) => {
    setCurrentProject((prev) => {
      if (!prev) return prev;
      const nextData = updater(prev.data || {});
      return { ...prev, data: nextData };
    });
    setIsDirty(true);
  }, []);

  const refreshProjectList = useCallback(async () => {
    if (!ipc) return;
    try {
      const list = await ipc.invoke('project:list');
      setProjects(Array.isArray(list) ? list : []);
    } catch (e) {
      addLog(`Project list failed: ${e?.message || String(e)}`);
    }
  }, [ipc, addLog]);

  useEffect(() => {
    try {
      globalVars.varImport(currentProject?.data?.variables || {});
      globalVars.arrImport?.(currentProject?.data?.arrays || {});
    } catch (_) {
    }
  }, [currentProject?.id]);

  useEffect(() => {
    routineXmlRamCacheRef.current.clear();
  }, [currentProject?.id]);

  const saveCurrentProject = useCallback(async () => {
    if (!ipc || !currentProject?.id) return;
    let routinesPayload = null;
    try {
      routinesPayload = await routinesRef.current?.exportForSave?.();
    } catch (e) {
      addLog(`Routine export failed: ${e?.message || String(e)}`);
    }
    const routinesList = Array.isArray(routinesPayload?.routines)
      ? routinesPayload.routines
      : Array.isArray(currentProject.data?.routines)
        ? currentProject.data.routines
        : [];
    const routineXmlById = routinesPayload?.routineXmlById && typeof routinesPayload.routineXmlById === 'object' ? routinesPayload.routineXmlById : null;
    const dataToSave = {
      ...(currentProject.data || {}),
      variables: (() => {
        try {
          return globalVars.varExport();
        } catch (_) {
          return currentProject.data?.variables || {};
        }
      })(),
      arrays: (() => {
        try {
          return globalVars.arrExport?.() || {};
        } catch (_) {
          return currentProject.data?.arrays || {};
        }
      })(),
      routines: routinesList,
      ...(routineXmlById ? { __routineXmlById: routineXmlById } : null),
      hardware: {
        ...(currentProject.data?.hardware || {}),
        modules: modules || currentProject.data?.hardware?.modules || null,
      },
    };
    const saved = await ipc.invoke('project:save', { id: currentProject.id, data: dataToSave });
    setCurrentProject(saved);
    setIsDirty(false);
    await refreshProjectList();
    addLog('Project saved');
  }, [ipc, currentProject, modules, refreshProjectList, addLog]);

  const openProjectDialog = useCallback(
    (mode) => {
      if ((mode === 'saveAs' || mode === 'edit') && !currentProject?.id) return;
      setProjectDialog({
        open: true,
        mode,
        name: mode === 'new' ? '' : currentProject?.data?.name || 'Project',
        description: mode === 'new' ? '' : currentProject?.data?.description || '',
      });
    },
    [currentProject?.id, currentProject?.data?.name, currentProject?.data?.description],
  );

  const submitProjectDialog = useCallback(async () => {
    if (!ipc) return;
    const name = String(projectDialog.name || '').trim();
    const description = String(projectDialog.description || '');
    if (!name) {
      addLog('Project name is required');
      return;
    }
    if (projectDialog.mode === 'new') {
      const created = await ipc.invoke('project:create', { name, description });
      await refreshProjectList();
      setCurrentProject(created);
      setIsDirty(false);
      setTab('model');
      if (ipc) ipc.invoke('ui:setTitle', `JIMU Control - ${created?.data?.name || name}`);
      addLog(`Project created: ${name}`);
      setProjectDialog((prev) => ({ ...prev, open: false }));
      return;
    }
    if (projectDialog.mode === 'saveAs') {
      if (!currentProject?.id) return;
      const saved = await ipc.invoke('project:clone', { fromId: currentProject.id, name, description });
      setCurrentProject(saved);
      setIsDirty(false);
      await refreshProjectList();
      addLog(`Project saved as "${name}"`);
      if (ipc) ipc.invoke('ui:setTitle', `JIMU Control - ${name}`);
      setProjectDialog((prev) => ({ ...prev, open: false }));
      return;
    }
    if (projectDialog.mode === 'edit') {
      if (!currentProject?.id) return;
      updateCurrentProjectData((d) => ({ ...d, name, description }));
      if (ipc) ipc.invoke('ui:setTitle', `JIMU Control - ${name}`);
      addLog('Project metadata updated (unsaved)');
      setProjectDialog((prev) => ({ ...prev, open: false }));
    }
  }, [ipc, projectDialog, refreshProjectList, currentProject?.id, updateCurrentProjectData, addLog]);

  const openProjectById = useCallback(
    async (id) => {
      if (!ipc) return;
      const loaded = await ipc.invoke('project:open', { id });
      setCurrentProject(loaded);
      setIsDirty(false);
      setTab('model');
      if (ipc) ipc.invoke('ui:setTitle', `JIMU Control - ${loaded?.data?.name || id}`);
      setServoDetail((prev) => {
        if (!prev) return prev;
        const liveIds = modules?.servos || [];
        if (!liveIds.includes(prev.id)) return null;
        const cfg = loaded?.data?.calibration?.servoConfig?.[prev.id];
        const mode = cfg?.mode || 'servo';
        const rawMin = cfg?.min ?? -120;
        const rawMax = cfg?.max ?? 120;
        const min = clamp(Number(rawMin), -120, 119);
        const max = clamp(Number(rawMax), min + 1, 120);
        const pos = clamp(Number(prev.pos ?? 0), min, max);
        return {
          ...prev,
          mode,
          min,
          max,
          pos,
          maxSpeed: cfg?.maxSpeed ?? 1000,
          reverse: Boolean(cfg?.reverse),
        };
      });
      setMotorDetail((prev) => {
        if (!prev) return prev;
        const liveIds = modules?.motors || [];
        if (!liveIds.includes(prev.id)) return null;
        const cfg = loaded?.data?.calibration?.motorConfig?.[prev.id];
        return {
          ...prev,
          maxSpeed: cfg?.maxSpeed ?? 150,
          reverse: Boolean(cfg?.reverse),
          speed: 0,
        };
      });
      return loaded;
    },
    [ipc, modules?.servos, modules?.motors],
  );

  const switchProjectTo = useCallback(
    async (id) => {
      if (isDirty && currentProject?.id) {
        const save = window.confirm('You have unsaved changes. Save now?');
        if (save) {
          try {
            await saveCurrentProject();
          } catch (e) {
            addLog(`Save failed: ${e?.message || String(e)}`);
            return;
          }
        } else {
          const discard = window.confirm('Discard changes and open another project?');
          if (!discard) return;
        }
      }
      await openProjectById(id);
    },
    [isDirty, currentProject?.id, saveCurrentProject, addLog, openProjectById],
  );

  const promptCreateProject = useCallback(async () => {
    if (!ipc) return;
    if (isDirty && currentProject?.id) {
      const save = window.confirm('You have unsaved changes. Save now?');
      if (save) {
        try {
          await saveCurrentProject();
        } catch (e) {
          addLog(`Save failed: ${e?.message || String(e)}`);
          return;
        }
      } else {
        const discard = window.confirm('Discard changes and create a new project?');
        if (!discard) return;
      }
    }
    openProjectDialog('new');
  }, [ipc, isDirty, currentProject?.id, saveCurrentProject, refreshProjectList, addLog, openProjectDialog]);

  const saveAsCurrentProject = useCallback(async () => {
    openProjectDialog('saveAs');
  }, [openProjectDialog]);

  const deleteProjectById = useCallback(
    async (id) => {
      if (!ipc || !id) return;
      if (id === currentProject?.id && isDirty) {
        const save = window.confirm('You have unsaved changes. Save now before deleting this project?');
        if (save) {
          try {
            await saveCurrentProject();
          } catch (e) {
            addLog(`Save failed: ${e?.message || String(e)}`);
            return;
          }
        } else {
          const discard = window.confirm('Discard changes and continue deleting this project?');
          if (!discard) return;
        }
      }
      const ok = window.confirm(`Delete project "${id}"? This removes it from ./jimu_saves/`);
      if (!ok) return;
      await ipc.invoke('project:delete', { id });
      if (currentProject?.id === id) {
        setCurrentProject(null);
        setIsDirty(false);
        if (ipc) ipc.invoke('ui:setTitle', 'JIMU Control');
      }
      await refreshProjectList();
      addLog(`Project deleted: ${id}`);
    },
    [ipc, currentProject?.id, isDirty, saveCurrentProject, refreshProjectList, addLog],
  );
  const closeServoPanel = async () => {
    if (servoDetail && ipc && status === 'Connected') {
      try {
        await ipc.invoke('jimu:rotateServo', { id: servoDetail.id, dir: 0x01, speed: 0 });
      } catch (_) {
      }
      try {
        await ipc.invoke('jimu:readServo', servoDetail.id);
      } catch (_) {
      }
    }
    setServoDetail(null);
  };
  const closeMotorPanel = async () => {
    if (motorDetail && ipc) {
      try {
        await ipc.invoke('jimu:stopMotor', motorDetail.id);
      } catch (_) {
      }
    }
    setMotorDetail(null);
  };

  const turnOffUltrasonicLeds = useCallback(
    async (ids) => {
      if (!ipc) return;
      const list = Array.isArray(ids) ? ids : [];
      for (const id of list) {
        try {
          await ipc.invoke('jimu:setUltrasonicLedOff', { id });
        } catch (_) {
        }
      }
    },
    [ipc],
  );
  const stopEyeAnimation = useCallback(async () => {
    if (eyeAnimCancelRef.current) {
      eyeAnimCancelRef.current();
      eyeAnimCancelRef.current = null;
    }
  }, []);
  const closeEyePanel = useCallback(async () => {
    await stopEyeAnimation();
    if (ipc && eyeDetail?.id) {
      const eyesMask = 1 << (eyeDetail.id - 1);
      try {
        await ipc.invoke('jimu:setEyeOff', { eyesMask });
      } catch (_) {
      }
    }
    setEyeDetail(null);
  }, [stopEyeAnimation, ipc, eyeDetail]);

  useEffect(() => {
    if (!ipc) return;
    const onStatus = (_e, data) => {
      setModules(data);
      setInitialModules((prevInit) => prevInit || data);
      if (currentProject?.id && data?.text) {
        setCurrentProject((prev) =>
          prev
            ? {
                ...prev,
                data: {
                  ...(prev.data || {}),
                  hardware: {
                    ...(prev.data?.hardware || {}),
                    firmware: data?.text || prev.data?.hardware?.firmware || null,
                  },
                },
              }
            : prev,
        );
      }
      addLog(`Status update: ${data?.text || 'n/a'}`);
    };
    const onBattery = (_e, data) => {
      setBattery(data);
      addLog(`Battery: ${data?.volts?.toFixed(3)}V ${data?.charging ? '(charging)' : ''}`);
    };
    const onDisconnect = () => {
      setStatus('Disconnected');
      setModules(null);
      setBattery(null);
      setServoDetail(null);
      setMotorDetail(null);
      setEyeDetail(null);
      stopEyeAnimation();
      setIrPanel({ open: false, live: false });
      setUsPanel((prev) => ({ ...prev, open: false, live: false }));
      setSensorReadings({ ir: {}, us: {} });
      setSensorError(null);
      addLog('Disconnected from device');
    };
    const onNewProject = () => {
      promptCreateProject();
    };
    const onSaveProject = () => {
      if (!currentProject?.id) return;
      saveCurrentProject().catch((e) => addLog(`Save failed: ${e?.message || String(e)}`));
    };
    const onOpenProject = () => {
      refreshProjectList().catch(() => {});
      addLog('Use the Project picker to open a project');
    };
    const onUiLog = (_e, data) => {
      const msg = typeof data === 'string' ? data : data?.message;
      if (msg) addLog(String(msg), { persist: false });
    };
    const onCloseProject = () => {
      handleCloseProject();
    };
    const onServoPos = (_e, data) => {
      if (!data) return;
      setServoDetail((prev) => (prev && prev.id === data.id ? { ...prev, lastPos: data.deg } : prev));
      addLog(`Servo ${data.id} position: ${data.deg}`);
    };
    const onDeviceError = (_e, data) => {
      const id = data?.deviceId != null ? ` id=${data.deviceId}` : '';
      addLog(`Device error ack cmd=0x${(data?.cmd ?? 0).toString(16)}${id} status=${data?.status}`);
    };
    const onErrorReport = (_e, data) => {
      addLog(`Error report (0x05) type=${data?.type ?? 'n/a'} mask=${(data?.maskBytes || []).join(',')}`);
    };
    const onTransportError = (_e, data) => {
      addLog(`Transport error: ${data?.message || 'unknown'}`);
    };
    const onCommandResult = (_e, data) => {
      if (!data) return;
      if (data.ok) return;
      addLog(`Command failed cmd=0x${(data.cmd ?? 0).toString(16)} status=${data.status}`);
    };
    const onTx = (_e, data) => {
      if (!verboseFrames) return;
      const cmd = data?.meta?.cmd ?? data?.cmd;
      const hex = payloadToHex(data?.payload);
      addLog(`=> cmd=0x${(cmd ?? 0).toString(16)} ${hex}`);
    };
    const onFrame = (_e, data) => {
      if (!verboseFrames) return;
      const cmd = data?.meta?.cmd ?? data?.cmd;
      const hex = payloadToHex(data?.payload);
      addLog(`<= cmd=0x${(cmd ?? 0).toString(16)} ${hex}`);
    };
    const onSensor = (_e, evt) => {
      const readings = evt?.parsed?.readings || [];
      if (!readings.length) return;
      const now = Date.now();
      setSensorReadings((prev) => {
        const next = { ir: { ...prev.ir }, us: { ...prev.us } };
        for (const r of readings) {
          if (r?.type === 0x01) next.ir[r.id] = { raw: r.value, at: now };
          if (r?.type === 0x06) next.us[r.id] = { raw: r.value, at: now };
        }
        return next;
      });
    };
    ipc.on('jimu:status', onStatus);
    ipc.on('jimu:battery', onBattery);
    ipc.on('jimu:disconnected', onDisconnect);
    ipc.on('ui:newProject', onNewProject);
    ipc.on('ui:saveProject', onSaveProject);
    ipc.on('ui:openProject', onOpenProject);
    ipc.on('ui:closeProject', onCloseProject);
    ipc.on('ui:log', onUiLog);
    ipc.on('jimu:servoPos', onServoPos);
    ipc.on('jimu:deviceError', onDeviceError);
    ipc.on('jimu:errorReport', onErrorReport);
    ipc.on('jimu:transportError', onTransportError);
    ipc.on('jimu:commandResult', onCommandResult);
    ipc.on('jimu:tx', onTx);
    ipc.on('jimu:frame', onFrame);
    ipc.on('jimu:sensor', onSensor);
    return () => {
      ipc.removeListener('jimu:status', onStatus);
      ipc.removeListener('jimu:battery', onBattery);
      ipc.removeListener('jimu:disconnected', onDisconnect);
      ipc.removeListener('ui:newProject', onNewProject);
      ipc.removeListener('ui:saveProject', onSaveProject);
      ipc.removeListener('ui:openProject', onOpenProject);
      ipc.removeListener('ui:closeProject', onCloseProject);
      ipc.removeListener('ui:log', onUiLog);
      ipc.removeListener('jimu:servoPos', onServoPos);
      ipc.removeListener('jimu:deviceError', onDeviceError);
      ipc.removeListener('jimu:errorReport', onErrorReport);
      ipc.removeListener('jimu:transportError', onTransportError);
      ipc.removeListener('jimu:commandResult', onCommandResult);
      ipc.removeListener('jimu:tx', onTx);
      ipc.removeListener('jimu:frame', onFrame);
      ipc.removeListener('jimu:sensor', onSensor);
    };
  }, [ipc, currentProject, addLog, verboseFrames, promptCreateProject, refreshProjectList, saveCurrentProject, stopEyeAnimation]);

  useEffect(() => {
    refreshProjectList().catch(() => {});
  }, [refreshProjectList]);

  useEffect(() => {
    if (!ipc) return;
    if (!irPanel.live && !usPanel.live) return;
    if (!modules?.ir?.length && !modules?.ultrasonic?.length) return;
    let disposed = false;
    const delayMs = 250;
    const run = async () => {
      while (!disposed) {
        try {
          const res = await ipc.invoke('jimu:readSensors');
          if (res?.error) {
            setSensorError(res.message || 'Sensor read failed');
          } else {
            setSensorError(null);
          }
        } catch (e) {
          setSensorError(e?.message || String(e));
        }
        await new Promise((r) => setTimeout(r, delayMs));
      }
    };
    run();
    return () => {
      disposed = true;
    };
  }, [ipc, irPanel.live, usPanel.live, modules?.ir, modules?.ultrasonic]);

  const handleConnect = async () => {
    if (!ipc) return addLog('IPC unavailable');
    if (!currentProject) return addLog('Select or create a project first');
    if (!selectedBrickId) return addLog('Scan and select a JIMU brick first');
    setStatus('Connecting...');
    try {
      const info = await ipc.invoke('jimu:connect', selectedBrickId);
      setStatus('Connected');
      setModules(info?.modules || null);
      setBattery(info?.battery || null);
      const nextBrick = {
        id: selectedBrickId,
        name: bricks.find((b) => b.id === selectedBrickId)?.name || null,
      };
      const nextFirmware = info?.modules?.text || null;
      const prevBrick = currentProject?.data?.hardware?.connectedBrick || null;
      const prevFirmware = currentProject?.data?.hardware?.firmware || null;
      const shouldMarkDirty =
        (!prevBrick && nextBrick?.id) ||
        prevBrick?.id !== nextBrick?.id ||
        prevBrick?.name !== nextBrick?.name ||
        (nextFirmware && prevFirmware !== nextFirmware);
      setCurrentProject((prev) =>
        prev
          ? {
              ...prev,
              data: {
                ...(prev.data || {}),
                hardware: {
                  ...(prev.data?.hardware || {}),
                  connectedBrick: nextBrick,
                  firmware: nextFirmware || prev.data?.hardware?.firmware || null,
                },
              },
            }
          : prev,
      );
      if (shouldMarkDirty) setIsDirty(true);
      setInitialModules(info?.modules || null);
      addLog('Connected to JIMU');
    } catch (err) {
      setStatus('Error');
      addLog(`Connect failed: ${err.message}`);
    }
  };

  const handleRefresh = async () => {
    if (!ipc) return;
    try {
      const s = await ipc.invoke('jimu:refreshStatus');
      setModules(s || null);
    } catch (e) {
      addLog(`Refresh status failed: ${e?.message || String(e)}`);
    }
  };

  const handleCloseProject = async () => {
    if (tab === 'routines') {
      await routinesRef.current.stopIfRunning?.();
    }
    await turnOffUltrasonicLeds(modules?.ultrasonic);
    if (isDirty) {
      const save = window.confirm('You have unsaved changes. Save now?');
      if (save) {
        try {
          await saveCurrentProject();
        } catch (e) {
          addLog(`Save failed: ${e?.message || String(e)}`);
        }
      } else {
        const discard = window.confirm('Discard changes and close project?');
        if (!discard) return;
      }
    }
    if (ipc) {
      try {
        await ipc.invoke('jimu:emergencyStop');
      } catch (_) {
      }
    }
    await closeServoPanel();
    await closeMotorPanel();
    await closeEyePanel();
    if (ipc) {
      try {
        await ipc.invoke('jimu:disconnect');
      } catch (_) {
      }
    }
    setModules(null);
    setBattery(null);
    setSelectedBrickId('');
    setInitialModules(null);
    setIrPanel({ open: false, live: false });
    setUsPanel((prev) => ({ ...prev, open: false, live: false }));
    setSensorReadings({ ir: {}, us: {} });
    setSensorError(null);
    setCurrentProject(null);
    setIsDirty(false);
    if (ipc) ipc.invoke('ui:setTitle', 'JIMU Control');
  };

  const handleReadSensors = async () => {
    if (!ipc) return;
    try {
      await ipc.invoke('jimu:readSensors');
      addLog('Requested sensor read');
    } catch (e) {
      addLog(`Sensor read request failed: ${e?.message || String(e)}`);
    }
  };

  const handleServoTest = async () => {
    if (!ipc) return;
    try {
      await ipc.invoke('jimu:setEyeRed');
      addLog('Eye set red (test)');
    } catch (e) {
      addLog(`Eye test failed: ${e?.message || String(e)}`);
    }
  };

  return (
    <div
      className="app-shell"
      style={{
        fontFamily: '"Bahnschrift", "Segoe UI", "Microsoft YaHei UI", sans-serif',
        padding: 20,
        width: '100%',
        boxSizing: 'border-box',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
        backgroundColor: 'var(--background-color)',
      }}
    >
      <div className="hero-panel">
        <div className="hero-copy">
          <div className="hero-eyebrow">
            <CubeIcon />
            <span>JIMU 控制矩阵</span>
          </div>
          <h1 className="hero-title">JIMU机器人控制中枢</h1>
        </div>
        <div className="hero-status">
          <div className="hero-status-card">
            <span className="hero-status-label">连接状态</span>
            <strong style={{ color: statusTone }}>{statusLabel}</strong>
          </div>
          <div className="hero-status-card">
            <span className="hero-status-label">当前项目</span>
            <strong>{hasProject ? currentProject?.data?.name || currentProject?.id : '未选择项目'}</strong>
          </div>
          <div className="hero-status-card">
            <span className="hero-status-label">电池状态</span>
            <BatteryIcon volts={battery?.volts} connected={isConnected} />
          </div>
        </div>
      </div>

      <div className="overview-grid">
        <div className="overview-card">
          <div className="overview-label">在线模块数</div>
          <div className="overview-value">{liveModuleCount}</div>
          <div className="overview-note">当前已检测到的实时硬件模块总数</div>
        </div>
        <div className="overview-card">
          <div className="overview-label">固件信息</div>
          <div className="overview-value overview-value-small">{firmware}</div>
          <div className="overview-note">来自当前设备的固件识别结果</div>
        </div>
        <div className="overview-card">
          <div className="overview-label">项目状态</div>
          <div className="overview-value overview-value-small">{hasProject ? '已加载' : '待命中'}</div>
          <div className="overview-note">{projectSummary}</div>
        </div>
      </div>

      <Section className="command-section">
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {!ipc ? (
            <div style={{ width: '100%', marginBottom: 8, color: '#b71c1c' }}>
              IPC不可用：在没有Electron桥接的情况下运行UI（设备和项目持久化已禁用）。
            </div>
          ) : null}
          {projectDialog.open ? (
            <div
              style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(0,0,0,0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 9999,
                backdropFilter: 'blur(4px)',
              }}
              onMouseDown={(e) => {
                if (e.target === e.currentTarget) setProjectDialog((prev) => ({ ...prev, open: false }));
              }}
            >
              <div style={{ 
                width: 'min(520px, 92vw)', 
                background: 'var(--card-background)', 
                borderRadius: 'var(--border-radius)', 
                padding: 20,
                boxShadow: 'var(--shadow-lg)',
                animation: 'fadeIn 0.3s ease-out'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                  <div style={{ fontWeight: 700, fontSize: 18, color: 'var(--text-primary)' }}>
                    {projectDialog.mode === 'new' ? '新建项目' : projectDialog.mode === 'saveAs' ? '另存为项目' : '编辑项目'}
                  </div>
                  <button 
                    onClick={() => setProjectDialog((prev) => ({ ...prev, open: false }))}
                    style={{
                      padding: '6px 12px',
                      fontSize: 14
                    }}
                  >
                    关闭
                  </button>
                </div>
                <div style={{ display: 'grid', gap: 12 }}>
                  <label style={{ display: 'grid', gap: 6 }}>
                    <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>名称</span>
                    <input
                      type="text"
                      value={projectDialog.name}
                      onChange={(e) => setProjectDialog((prev) => ({ ...prev, name: e.target.value }))}
                      autoFocus
                      style={{
                        padding: '10px 12px',
                        fontSize: 14
                      }}
                    />
                  </label>
                  <label style={{ display: 'grid', gap: 6 }}>
                    <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>描述</span>
                    <textarea
                      rows={3}
                      value={projectDialog.description}
                      onChange={(e) => setProjectDialog((prev) => ({ ...prev, description: e.target.value }))}
                      style={{
                        padding: '10px 12px',
                        fontSize: 14,
                        resize: 'vertical'
                      }}
                    />
                  </label>
                  {projectDialog.mode === 'edit' ? (
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', padding: '12px', backgroundColor: '#f8fafc', borderRadius: 'var(--border-radius)' }}>
                      <button
                        onClick={async () => {
                          if (!ipc || !currentProject?.id) return;
                          try {
                            const res = await ipc.invoke('project:setThumbnail', { id: currentProject.id });
                            if (res?.thumbnailDataUrl) {
                              setCurrentProject((prev) => (prev ? { ...prev, thumbnailDataUrl: res.thumbnailDataUrl } : prev));
                              await refreshProjectList();
                              addLog('Thumbnail updated');
                            }
                          } catch (e) {
                            addLog(`Thumbnail set failed: ${e?.message || String(e)}`);
                          }
                        }}>
                        修改缩略图
                      </button>
                      <button
                        onClick={async () => {
                          if (!currentProject?.id) return;
                          await deleteProjectById(currentProject.id);
                          setProjectDialog((prev) => ({ ...prev, open: false }));
                        }}
                        style={{ 
                          background: '#ef4444', 
                          color: '#fff', 
                          border: '1px solid #ef4444',
                          transition: 'var(--transition)'
                        }}
                      >
                        删除项目
                      </button>
                    </div>
                  ) : null}
                  <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 8 }}>
                    <button 
                      onClick={() => setProjectDialog((prev) => ({ ...prev, open: false }))}
                      style={{
                        flex: 1
                      }}
                    >
                      取消
                    </button>
                    <button
                      onClick={() => {
                        submitProjectDialog().catch((e) => addLog(`项目操作失败: ${e?.message || String(e)}`));
                      }}
                      style={{
                        flex: 1,
                        background: 'var(--primary-color)',
                        color: '#fff',
                        border: '1px solid var(--primary-color)',
                        transition: 'var(--transition)'
                      }}
                    >
                      {projectDialog.mode === 'new' ? '创建' : projectDialog.mode === 'saveAs' ? '另存为' : '应用'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
          {!hasProject ? (
            <div style={{ flex: 1, minWidth: 260 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
                <button onClick={promptCreateProject}>新建项目</button>
                <button onClick={refreshProjectList}>刷新列表</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 16 }}>
                {projects.map((p) => (
                  <div
                    key={p.id}
                    style={{
                      border: '1px solid var(--border-color)',
                      borderRadius: 'var(--border-radius)',
                      padding: 16,
                      display: 'grid',
                      gridTemplateColumns: '80px 1fr',
                      gap: 12,
                      alignItems: 'start',
                      backgroundColor: 'var(--card-background)',
                      boxShadow: 'var(--shadow-md)',
                      transition: 'var(--transition)',
                      cursor: 'pointer',
                    }}
                    onClick={() => switchProjectTo(p.id)}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = 'translateY(-2px)';
                      e.currentTarget.style.boxShadow = 'var(--shadow-lg)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = 'translateY(0)';
                      e.currentTarget.style.boxShadow = 'var(--shadow-md)';
                    }}
                  >
                    <div
                      style={{
                        width: 72,
                        height: 72,
                        borderRadius: 'var(--border-radius)',
                        border: '1px solid var(--border-color)',
                        background: '#f8fafc',
                        overflow: 'hidden',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                      title={p.thumbnailDataUrl ? '缩略图' : '无缩略图'}
                    >
                      {p.thumbnailDataUrl ? (
                        <img src={p.thumbnailDataUrl} width={72} height={72} alt="" style={{ display: 'block', objectFit: 'cover' }} />
                      ) : (
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>无缩略图</div>
                      )}
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, marginBottom: 6, color: 'var(--text-primary)', fontSize: 15 }}>{p.name || p.id}</div>
                      <div style={{ color: 'var(--text-secondary)', fontSize: 13, minHeight: 40, lineHeight: 1.4 }}>
                        {p.description ? (
                          String(p.description).slice(0, 100)
                        ) : (
                          <span style={{ color: '#94a3b8' }}>无描述</span>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            switchProjectTo(p.id);
                          }}
                          style={{
                            background: 'var(--primary-color)',
                            color: '#fff',
                            border: '1px solid var(--primary-color)',
                            transition: 'var(--transition)'
                          }}
                        >
                          打开
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                {projects.length === 0 ? <div style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: 24 }}>暂无保存的项目。</div> : null}
              </div>
            </div>
          ) : (
            <div style={{ flex: 1, minWidth: 260 }}>
              <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap', padding: 16, backgroundColor: 'var(--card-background)', borderRadius: 'var(--border-radius)', boxShadow: 'var(--shadow-md)' }}>
                <button
                  onClick={() => openProjectDialog('edit')}
                  style={{
                    width: 80,
                    height: 80,
                    padding: 0,
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--border-radius)',
                    background: '#f8fafc',
                    overflow: 'hidden',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'var(--transition)',
                    boxShadow: 'var(--shadow-sm)'
                  }}
                  title="项目缩略图（编辑以更改）"
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'scale(1.05)';
                    e.currentTarget.style.boxShadow = 'var(--shadow-md)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'scale(1)';
                    e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
                  }}
                >
                  {currentProject?.thumbnailDataUrl ? (
                    <img
                      src={currentProject.thumbnailDataUrl}
                      width={80}
                      height={80}
                      alt=""
                      style={{ display: 'block', objectFit: 'cover' }}
                    />
                  ) : (
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>无缩略图</div>
                  )}
                </button>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ fontWeight: 700, fontSize: 18, color: 'var(--text-primary)' }}>
                      项目 {currentProject?.data?.name || currentProject?.id}
                      {isDirty ? <span style={{ marginLeft: 8, color: '#ef4444' }}>*</span> : null}
                    </div>
                    <button 
                      onClick={() => openProjectDialog('edit')}
                      style={{
                        transition: 'var(--transition)'
                      }}
                    >
                      编辑
                    </button>
                  </div>
                  <div style={{ marginTop: 8, color: 'var(--text-secondary)' }}>
                    <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>描述：</span>{' '}
                    {currentProject?.data?.description ? (
                      <span>{currentProject.data.description}</span>
                    ) : (
                      <span style={{ color: '#94a3b8' }}>—</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
                    <button
                      onClick={() =>
                        saveCurrentProject().catch((e) => addLog(`保存失败: ${e?.message || String(e)}`))
                      }
                      style={{
                        background: 'var(--primary-color)',
                        color: '#fff',
                        border: '1px solid var(--primary-color)',
                        transition: 'var(--transition)'
                      }}
                    >
                      保存
                    </button>
                    <button onClick={saveAsCurrentProject}>
                      另存为
                    </button>
                    <button
                      onClick={async () => {
                        if (!currentProject?.id) return;
                        if (isDirty) {
                          const ok = window.confirm('放弃本地更改并从磁盘重新加载？');
                          if (!ok) return;
                        }
                        await openProjectById(currentProject.id);
                        addLog('项目已重新加载');
                      }}
                    >
                      恢复
                    </button>
                    <button onClick={handleCloseProject}>关闭</button>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div
            style={{ marginLeft: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}
          >
            <button
              onClick={async () => {
                if (!ipc) return;
                try {
                  await routinesRef.current?.stopIfRunning?.();
                  await ipc.invoke('jimu:emergencyStop');
                  addLog('已执行紧急停止');
                } catch (e) {
                  addLog(`紧急停止失败: ${e?.message || String(e)}`);
                }
              }}
              style={{
                background: '#c62828',
                color: '#fff',
                border: '1px solid #8e0000',
                height: 42,
              }}
              title="停止电机/旋转并释放伺服电机（尽力而为）"
            >
              紧急停止
            </button>
          </div>
        </div>
      </Section>

      {!hasProject ? (
        <Section title="创建或选择项目">
          <div style={{ color: '#8ba9c8' }}>请先使用上方操作区新建项目，或打开已有项目后再继续。</div>
        </Section>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          <div className="tab-strip">
            {tabItems.map(({ key: t, label, icon }) => (
              <button
                key={t}
                className={`tab-chip ${tab === t ? 'active' : ''}`}
                onClick={async () => {
                  if (tab === 'routines' && t !== 'routines') {
                    await routinesRef.current.stopIfRunning?.();
                  }
                  if (tab === 'voice' && t !== 'voice') {
                    await voiceRef.current.stopIfRunning?.();
                  }
                  if (tab === 'control' && t !== 'control') {
                    await controlRef.current.stopIfRunning?.();
                  }
                  await closeServoPanel();
                  await closeMotorPanel();
                  await closeEyePanel();
                  await turnOffUltrasonicLeds(modules?.ultrasonic);
                  setIrPanel({ open: false, live: false });
                  setUsPanel((prev) => ({ ...prev, open: false, live: false }));
                  setSensorError(null);
                  setTab(t);
                }}
                style={{
                  flex: 1,
                }}
              >
                {icon}
                <span>{label}</span>
              </button>
            ))}
          </div>

          {tab === 'model' && (
            <>
              <Section title="连接">
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button
                    onClick={async () => {
                      if (!ipc) return;
                      setIsScanning(true);
                      try {
                        const found = await ipc.invoke('jimu:scan');
                        setBricks(found);
                        const preferredId = currentProject?.data?.hardware?.connectedBrick?.id;
                        if (preferredId && found.some((b) => b.id === preferredId)) {
                          setSelectedBrickId(preferredId);
                        }
                        addLog(`扫描发现 ${found.length} 个设备`);
                      } catch (e) {
                        addLog(`扫描失败: ${e?.message || String(e)}`);
                      } finally {
                        setIsScanning(false);
                      }
                    }}
                  >
                    {isScanning ? '扫描中...' : '扫描设备'}
                  </button>
                  <select value={selectedBrickId} onChange={(e) => setSelectedBrickId(e.target.value)}>
                    <option value="">选择设备</option>
                    {bricks.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name} ({b.id})
                      </option>
                    ))}
                  </select>
                  <button onClick={handleConnect}>连接</button>
                  <button onClick={handleRefresh}>刷新状态</button>
                  <span>
                    状态:{' '}
                    <span
                      style={{
                        fontWeight: 700,
                        color:
                          status === 'Connected'
                            ? '#2ea44f'
                            : status === 'Disconnected'
                              ? '#777'
                              : status === 'Error'
                                ? '#c62828'
                                : '#444',
                      }}
                    >
                      {status === 'Connected' ? '已连接' : status === 'Disconnected' ? '未连接' : status === 'Error' ? '错误' : status}
                    </span>
                  </span>
                  <div style={{ marginLeft: 'auto' }} />
                  <button
                    disabled={!ipc}
                    onClick={() => {
                      setIdChangeError(null);
                      setIdChangeOpen(true);
                    }}
                  >
                    修改ID
                  </button>
                </div>
                <div style={{ marginTop: 8 }}>
                  <strong>固件:</strong> {firmware}
                  <br />
                  <strong>电池:</strong>{' '}
                  {battery ? `${battery.volts.toFixed(3)}V ${battery.charging ? '(充电中)' : ''}` : '无'}
                </div>
              </Section>

              {idChangeOpen && (
                <div
                  style={{
                    position: 'fixed',
                    inset: 0,
                    background: 'rgba(0,0,0,0.35)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 9999,
                    padding: 16,
                  }}
                  onMouseDown={() => setIdChangeOpen(false)}
                >
                  <div
                    style={{
                      width: 'min(780px, 100%)',
                      background: '#fff',
                      borderRadius: 10,
                      border: '1px solid #ddd',
                      boxShadow: '0 10px 40px rgba(0,0,0,0.25)',
                      padding: 14,
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                      <div style={{ fontWeight: 800, fontSize: 14 }}>修改模块ID</div>
                      <button onClick={() => setIdChangeOpen(false)}>取消</button>
                    </div>

                    <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <span style={{ fontSize: 12, color: '#555' }}>模块</span>
                        <select
                          value={idChange.module}
                          onChange={(e) => {
                            const next = String(e.target.value || 'servo');
                            setIdChange({ module: next, fromId: 0, toId: 1 });
                            setIdChangeError(null);
                          }}
                        >
                          <option value="servo">伺服电机</option>
                          <option value="motor">电机</option>
                          <option value="ir">红外</option>
                          <option value="ultrasonic">超声波</option>
                          <option value="eye">眼睛</option>
                          <option value="speaker">扬声器</option>
                        </select>
                      </label>

                      <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <span style={{ fontSize: 12, color: '#555' }}>从ID</span>
                        <select
                          value={String(idChange.fromId)}
                          onChange={(e) => {
                            const next = Number(e.target.value);
                            setIdChange((prev) => ({ ...prev, fromId: Number.isFinite(next) ? next : 0 }));
                            setIdChangeError(null);
                          }}
                        >
                          {idChangeFromOptions.map((id) => (
                            <option key={`from-${id}`} value={String(id)}>
                              {id === 0 ? '0 (修复)' : String(id)}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <span style={{ fontSize: 12, color: '#555' }}>到ID</span>
                        <input
                          type="number"
                          min={1}
                          max={idChangeMax}
                          value={idChange.toId}
                          onChange={(e) => {
                            const next = Number(e.target.value);
                            setIdChange((prev) => ({ ...prev, toId: Number.isFinite(next) ? next : 1 }));
                            setIdChangeError(null);
                          }}
                          style={{ width: 88 }}
                        />
                        <span style={{ fontSize: 12, color: '#777' }}>(1..{idChangeMax})</span>
                      </label>

                      <button
                        disabled={!isConnected || !ipc || isChangingId}
                        onClick={async () => {
                          if (!ipc) return;
                          if (!isConnected) return setIdChangeError('请先连接设备');

                          const kind = String(idChange.module || '').toLowerCase();
                          const max = kind === 'servo' ? 32 : 8;
                          const fromId = Math.max(0, Math.min(max, Math.round(Number(idChange.fromId))));
                          const toId = Math.max(1, Math.min(max, Math.round(Number(idChange.toId))));
                          if (!Number.isFinite(fromId) || !Number.isFinite(toId)) {
                            setIdChangeError('无效的ID值');
                            return;
                          }
                          if (kind === 'servo' && (toId < 1 || toId > 32)) {
                            setIdChangeError('伺服电机ID必须为1..32');
                            return;
                          }
                          if (kind !== 'servo' && (toId < 1 || toId > 8)) {
                            setIdChangeError('外设ID必须为1..8');
                            return;
                          }

                          setIsChangingId(true);
                          setIdChangeError(null);
                          try {
                            await closeServoPanel();
                            await closeMotorPanel();
                            await closeEyePanel();
                            await turnOffUltrasonicLeds(modules?.ultrasonic);
                            setIrPanel({ open: false, live: false });
                            setUsPanel((prev) => ({ ...prev, open: false, live: false }));
                            setSensorError(null);

                            await ipc.invoke('jimu:changeModuleId', { module: kind, fromId, toId });
                            addLog(`已修改${kind} ID: ${fromId} -> ${toId}`);
                            setIdChange((prev) => ({ ...prev, fromId: toId }));

                            const s = await ipc.invoke('jimu:refreshStatus');
                            setModules(s || null);
                          } catch (e) {
                            const msg = e?.message || String(e);
                            setIdChangeError(msg);
                            addLog(`修改ID失败: ${msg}`);
                          } finally {
                            setIsChangingId(false);
                          }
                        }}
                      >
                        {isChangingId ? '修改中...' : '修改ID'}
                      </button>
                    </div>

                    {idChangeError && <div style={{ marginTop: 10, color: '#c62828' }}>{idChangeError}</div>}
                    <div style={{ marginTop: 10, fontSize: 12, color: '#666' }}>
                      需要 active 连接。修改ID后，应用会刷新状态以重新扫描检测到的模块。
                    </div>
                  </div>
                </div>
              )}

              <Section title="模型配置（实时概览）">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12 }}>
                  <div>
                    <strong>伺服电机</strong>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                      {uniqSortedNums([
                        ...(currentProject?.data?.hardware?.modules?.servos || []),
                        ...(modules?.servos || []),
                      ]).map((id) => {
                        const savedIds = currentProject?.data?.hardware?.modules?.servos || [];
                        const liveIds = modules?.servos || [];
                        const isLive = isConnected && liveIds.includes(id);
                        const statusKind = getModuleStatusKind(id, savedIds, liveIds, { connected: isConnected });
                        const cfg = currentProject?.data?.calibration?.servoConfig?.[id] || {};
                        const mode = String(cfg?.mode || 'servo');
                        const showServoIcon = mode === 'servo' || mode === 'mixed' || !mode;
                        const showWheelIcon = mode === 'motor' || mode === 'mixed';
                        return (
                          <button
                            key={`sv${id}`}
                            onClick={async () => {
                              if (!isLive) return;
                            if (servoDetail && servoDetail.id !== id) {
                              await closeServoPanel();
                            }
                            if (motorDetail) await closeMotorPanel();
                            if (eyeDetail) await closeEyePanel();
                            await turnOffUltrasonicLeds(modules?.ultrasonic);
                            setIrPanel({ open: false, live: false });
                            setUsPanel((prev) => ({ ...prev, open: false, live: false }));
                            setSensorError(null);
                            setServoDetail((prev) => {
                              const cfg = currentProject?.data?.calibration?.servoConfig?.[id] || {};
                              const mode = prev?.id === id ? prev.mode : cfg.mode || 'servo';
                              const rawMin = prev?.id === id ? prev.min : cfg.min ?? -120;
                              const rawMax = prev?.id === id ? prev.max : cfg.max ?? 120;
                              const min = clamp(Number(rawMin), -120, 119);
                              const max = clamp(Number(rawMax), min + 1, 120);
                              const pos = prev?.id === id ? prev.pos : clamp(0, min, max);
                              return {
                                id,
                                mode,
                                min,
                                max,
                                pos,
                                speed: prev?.id === id ? prev.speed : 0,
                                maxSpeed: prev?.id === id ? prev.maxSpeed : cfg.maxSpeed ?? 1000,
                                reverse: prev?.id === id ? prev.reverse : Boolean(cfg.reverse),
                                dir: prev?.id === id ? prev.dir : 'cw',
                                lastPos: prev?.id === id ? prev.lastPos : null,
                              };
                            });
                            if (ipc) {
                              try {
                                await ipc.invoke('jimu:readServo', id);
                              } catch (e) {
                                addLog(`Servo ${id} read failed: ${e?.message || String(e)}`);
                              }
                            }
                            }}
                            style={moduleButtonStyle(statusKind, isLive)}
                            title={statusKind}
                          >
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              <span>Servo {id}</span>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 2 }}>
                                {showServoIcon ? (
                                  <img
                                    src={servoIconUrl}
                                    width={14}
                                    height={14}
                                    style={{ display: 'block' }}
                                    alt="servo mode"
                                    title="servo/mixed mode"
                                  />
                                ) : null}
                                {showWheelIcon ? (
                                  <img
                                    src={wheelIconUrl}
                                    width={14}
                                    height={14}
                                    style={{ display: 'block' }}
                                    alt="motor mode"
                                    title="motor/mixed mode"
                                  />
                                ) : null}
                              </span>
                            </span>
                          </button>
                        );
                      }) || <span>none</span>}
                    </div>
                  </div>
                  <div>
                    <strong>电机</strong>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                      {uniqSortedNums([
                        ...(currentProject?.data?.hardware?.modules?.motors || []),
                        ...(modules?.motors || []),
                      ]).map((id) => {
                        const savedIds = currentProject?.data?.hardware?.modules?.motors || [];
                        const liveIds = modules?.motors || [];
                        const isLive = isConnected && liveIds.includes(id);
                        const statusKind = getModuleStatusKind(id, savedIds, liveIds, { connected: isConnected });
                        return (
                          <button
                            key={`m${id}`}
                            onClick={async () => {
                              if (!isLive) return;
                            if (motorDetail && motorDetail.id !== id) await closeMotorPanel();
                            if (servoDetail) await closeServoPanel();
                            if (eyeDetail) await closeEyePanel();
                            await turnOffUltrasonicLeds(modules?.ultrasonic);
                            setIrPanel({ open: false, live: false });
                            setUsPanel((prev) => ({ ...prev, open: false, live: false }));
                            setSensorError(null);
                            setMotorDetail((prev) => ({
                              id,
                              reverse: prev?.id === id ? prev.reverse : Boolean(currentProject?.data?.calibration?.motorConfig?.[id]?.reverse),
                              dir: prev?.id === id ? prev.dir : 'cw',
                              speed: 0,
                              maxSpeed: prev?.id === id ? prev.maxSpeed : currentProject?.data?.calibration?.motorConfig?.[id]?.maxSpeed ?? 150,
                              durationMs: prev?.id === id ? prev.durationMs : 1000,
                            }));
                            }}
                            style={moduleButtonStyle(statusKind, isLive)}
                            title={statusKind}
                          >
                            电机 {id}
                          </button>
                        );
                      }) || <span>无</span>}
                    </div>
                  </div>
                  <div>
                    <strong>红外</strong>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                      {uniqSortedNums([
                        ...(currentProject?.data?.hardware?.modules?.ir || []),
                        ...(modules?.ir || []),
                      ]).map((id) => {
                        const savedIds = currentProject?.data?.hardware?.modules?.ir || [];
                        const liveIds = modules?.ir || [];
                        const isLive = isConnected && liveIds.includes(id);
                        const statusKind = getModuleStatusKind(id, savedIds, liveIds, { connected: isConnected });
                        return (
                          <button
                            key={`ir${id}`}
                            onClick={async () => {
                              if (!isLive) return;
                            if (servoDetail) await closeServoPanel();
                            if (motorDetail) await closeMotorPanel();
                            if (eyeDetail) await closeEyePanel();
                            await turnOffUltrasonicLeds(modules?.ultrasonic);
                            setUsPanel((prev) => ({ ...prev, open: false, live: false }));
                            setIrPanel({ open: true, live: true });
                            }}
                            style={moduleButtonStyle(statusKind, isLive)}
                            title={statusKind}
                          >
                            红外 {id}
                          </button>
                        );
                      }) || <span>无</span>}
                    </div>
                  </div>
                  <div>
                    <strong>超声波</strong>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                      {uniqSortedNums([
                        ...(currentProject?.data?.hardware?.modules?.ultrasonic || []),
                        ...(modules?.ultrasonic || []),
                      ]).map((id) => {
                        const savedIds = currentProject?.data?.hardware?.modules?.ultrasonic || [];
                        const liveIds = modules?.ultrasonic || [];
                        const isLive = isConnected && liveIds.includes(id);
                        const statusKind = getModuleStatusKind(id, savedIds, liveIds, { connected: isConnected });
                        return (
                          <button
                            key={`us${id}`}
                            onClick={async () => {
                              if (!isLive) return;
                            if (servoDetail) await closeServoPanel();
                            if (motorDetail) await closeMotorPanel();
                            if (eyeDetail) await closeEyePanel();
                            setIrPanel({ open: false, live: false });
                            setUsPanel((prev) => ({ ...prev, open: true, live: true, led: { ...prev.led, id } }));
                            }}
                            style={moduleButtonStyle(statusKind, isLive)}
                            title={statusKind}
                          >
                            超声波 {id}
                          </button>
                        );
                      }) || <span>无</span>}
                    </div>
                  </div>
                  <div>
                    <strong>眼睛</strong>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                      {uniqSortedNums([
                        ...(currentProject?.data?.hardware?.modules?.eyes || []),
                        ...(modules?.eyes || []),
                      ]).map((id) => {
                        const savedIds = currentProject?.data?.hardware?.modules?.eyes || [];
                        const liveIds = modules?.eyes || [];
                        const isLive = isConnected && liveIds.includes(id);
                        const statusKind = getModuleStatusKind(id, savedIds, liveIds, { connected: isConnected });
                        return (
                          <button
                            key={`eye${id}`}
                            onClick={async () => {
                              if (!isLive) return;
                            if (servoDetail) await closeServoPanel();
                            if (motorDetail) await closeMotorPanel();
                            await turnOffUltrasonicLeds(modules?.ultrasonic);
                            setIrPanel({ open: false, live: false });
                            setUsPanel((prev) => ({ ...prev, open: false, live: false }));
                            setSensorError(null);
                            await stopEyeAnimation();
                            const initialHex = '#00ff00';
                            const rgb = hexToRgb(initialHex);
                            setEyeDetail({
                              id,
                              hex: initialHex,
                              r: rgb?.r ?? 0,
                              g: rgb?.g ?? 255,
                              b: rgb?.b ?? 0,
                              anim: 'none',
                              speedMs: 250,
                            });
                            }}
                            style={moduleButtonStyle(statusKind, isLive)}
                            title={statusKind}
                          >
                            眼睛 {id}
                          </button>
                        );
                      }) || <span>无</span>}
                    </div>
                  </div>
                  <div>
                    <strong>扬声器</strong>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                      {uniqSortedNums([
                        ...(currentProject?.data?.hardware?.modules?.speakers || []),
                        ...(modules?.speakers || []),
                      ]).map((id) => {
                        const savedIds = currentProject?.data?.hardware?.modules?.speakers || [];
                        const liveIds = modules?.speakers || [];
                        const isLive = isConnected && liveIds.includes(id);
                        const statusKind = getModuleStatusKind(id, savedIds, liveIds, { connected: isConnected });
                        return (
                          <span
                            key={`spk${id}`}
                            style={{ ...moduleBadgeStyle(statusKind), opacity: isLive ? 1 : 0.65 }}
                            title={statusKind}
                          >
                            扬声器 {id}
                          </span>
                        );
                      })}
                      {uniqSortedNums([
                        ...(currentProject?.data?.hardware?.modules?.speakers || []),
                        ...(modules?.speakers || []),
                      ]).length === 0 ? (
                        <span style={{ color: '#777' }}>无</span>
                      ) : null}
                    </div>
                  </div>
                </div>
                {servoDetail && (
                  <div style={{ marginTop: 12, padding: 12, border: '1px solid #ddd', borderRadius: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <h3 style={{ margin: 0 }}>已选择伺服电机 ID{servoDetail.id}</h3>
                      <button onClick={closeServoPanel}>关闭</button>
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <label>
                        模式:{' '}
                        <select
                          value={servoDetail.mode}
                          onChange={(e) => setServoDetail((prev) => ({ ...prev, mode: e.target.value }))}
                        >
                          <option value="servo">伺服</option>
                          <option value="motor">电机</option>
                          <option value="mixed">混合</option>
                        </select>
                      </label>
                      <label style={{ marginLeft: 12 }}>
                        <input
                          type="checkbox"
                          checked={Boolean(servoDetail.reverse)}
                          onChange={(e) => setServoDetail((prev) => ({ ...prev, reverse: e.target.checked }))}
                        />{' '}
                        反转
                      </label>
                    </div>
                    {(servoDetail.mode === 'servo' || servoDetail.mode === 'mixed') && (
                      <div style={{ marginTop: 12 }}>
                        <TouchBarSlider
                          minValue={servoDetail.min}
                          maxValue={servoDetail.max}
                          value={servoDetail.pos}
                          onChange={({ min, max, value }) =>
                            setServoDetail((prev) => {
                              const safeMin = clamp(min, -120, 119);
                              const safeMax = clamp(max, safeMin + 1, 120);
                              const safePos = clamp(value, safeMin, safeMax);
                              return { ...prev, min: safeMin, max: safeMax, pos: safePos };
                            })
                          }
                        />
                        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
                          <label>
                            最小值{' '}
                            <input
                              type="number"
                              style={{ width: 70 }}
                              value={servoDetail.min}
                              onChange={(e) =>
                                setServoDetail((prev) => {
                                  const min = clamp(Number(e.target.value), -120, prev.max - 1);
                                  const pos = clamp(prev.pos, min, prev.max);
                                  return { ...prev, min, pos };
                                })
                              }
                            />
                          </label>
                          <label>
                            最大值{' '}
                            <input
                              type="number"
                              style={{ width: 70 }}
                              value={servoDetail.max}
                              onChange={(e) =>
                                setServoDetail((prev) => {
                                  const max = clamp(Number(e.target.value), prev.min + 1, 120);
                                  const pos = clamp(prev.pos, prev.min, max);
                                  return { ...prev, max, pos };
                                })
                              }
                            />
                          </label>
                          <span>
                            测试位置: <strong>{servoDetail.pos}</strong> 度
                          </span>
                        </div>
                        <div>
                          <button
                            onClick={async () => {
                              if (!ipc) return;
                              try {
                                const res = await ipc.invoke('jimu:readServo', servoDetail.id);
                                const deg = typeof res?.deg === 'number' ? res.deg : null;
                                if (deg == null) {
                                  addLog(`伺服电机 ${servoDetail.id} 读取未返回位置`);
                                  return;
                                }
                                const uiDeg = servoDetail.reverse ? -deg : deg;
                                setServoDetail((prev) => {
                                  if (!prev || prev.id !== servoDetail.id) return prev;
                                  const pos = clamp(Math.round(uiDeg), prev.min, prev.max);
                                  return { ...prev, pos, lastPos: pos };
                                });
                                addLog(`伺服电机 ${servoDetail.id} 位置读取: ${deg} 度`);
                              } catch (e) {
                                addLog(`伺服电机 ${servoDetail.id} 读取失败: ${e?.message || String(e)}`);
                              }
                            }}
                          >
                            获取位置
                          </button>
                          <button
                            style={{ marginLeft: 8 }}
                            onClick={async () => {
                              if (!ipc) return;
                              try {
                                await ipc.invoke('jimu:setServoPos', {
                                  id: servoDetail.id,
                                  posDeg: servoDetail.reverse ? -servoDetail.pos : servoDetail.pos,
                                });
                                setServoDetail((prev) => ({ ...prev, lastPos: servoDetail.pos }));
                                addLog(`伺服电机 ${servoDetail.id} -> 位置 ${servoDetail.pos}`);
                              } catch (e) {
                                addLog(`伺服电机设置位置失败: ${e?.message || String(e)}`);
                              }
                            }}
                          >
                            测试位置
                          </button>
                          <button
                            style={{ marginLeft: 8 }}
                            onClick={async () => {
                              if (!ipc) return;
                              setServoDetail((prev) => ({ ...prev, lastPos: 'pending' }));
                              try {
                                await ipc.invoke('jimu:readServo', servoDetail.id);
                                addLog(`伺服电机 ${servoDetail.id} 已释放 (readServo)`);
                              } catch (e) {
                                addLog(`伺服电机释放失败: ${e?.message || String(e)}`);
                                setServoDetail((prev) => ({ ...prev, lastPos: 'error' }));
                              }
                            }}
                          >
                            停止/释放
                          </button>
                        </div>
                      </div>
                    )}
                    {(servoDetail.mode === 'motor' || servoDetail.mode === 'mixed') && (
                      <div style={{ marginTop: 12 }}>
                        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                          <label>
                            <input
                              type="radio"
                              checked={servoDetail.dir === 'ccw'}
                              onChange={() => setServoDetail((prev) => ({ ...prev, dir: 'ccw' }))}
                            />{' '}
                            逆时针
                          </label>
                          <label>
                            <input
                              type="radio"
                              checked={servoDetail.dir === 'cw'}
                              onChange={() => setServoDetail((prev) => ({ ...prev, dir: 'cw' }))}
                            />{' '}
                            顺时针
                          </label>
                          <label>
                            最大速度 (1-1000){' '}
                            <input
                              type="number"
                              style={{ width: 100 }}
                              value={servoDetail.maxSpeed ?? 1000}
                              onChange={(e) =>
                                setServoDetail((prev) => {
                                  const ms = Math.max(1, Math.min(1000, Number(e.target.value)));
                                  return { ...prev, maxSpeed: ms, speed: Math.min(prev.speed ?? ms, ms) };
                                })
                              }
                            />
                          </label>
                        </div>
                        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span>0</span>
                          <input
                            type="range"
                            min={0}
                            max={servoDetail.maxSpeed ?? 1000}
                            value={servoDetail.speed ?? 0}
                            onChange={(e) =>
                              setServoDetail((prev) => ({
                                ...prev,
                                speed: Math.max(0, Math.min(prev.maxSpeed ?? 1000, Number(e.target.value))),
                              }))
                            }
                            style={{ flex: 1 }}
                          />
                          <span>{servoDetail.maxSpeed ?? 1000}</span>
                          <span style={{ marginLeft: 8 }}>速度: {servoDetail.speed ?? 0}</span>
                        </div>
                        <div style={{ marginTop: 8 }}>
                          <button
                            onClick={async () => {
                              if (!ipc) return;
                              const dirBase = servoDetail.dir === 'cw' ? 0x01 : 0x02;
                              const dir = servoDetail.reverse ? (dirBase === 0x01 ? 0x02 : 0x01) : dirBase;
                              try {
                                await ipc.invoke('jimu:rotateServo', {
                                  id: servoDetail.id,
                                  dir,
                                  speed: servoDetail.speed ?? 0,
                                  maxSpeed: servoDetail.maxSpeed ?? 1000,
                                });
                                addLog(`伺服电机 ${servoDetail.id} 旋转 dir=${dir} speed=${servoDetail.speed}`);
                              } catch (e) {
                                addLog(`伺服电机旋转失败: ${e?.message || String(e)}`);
                              }
                            }}
                          >
                            测试旋转
                          </button>
                          <button
                            style={{ marginLeft: 8 }}
                            onClick={async () => {
                              if (!ipc) return;
                              try {
                                await ipc.invoke('jimu:readServo', servoDetail.id);
                                setServoDetail((prev) => ({ ...prev, speed: 0 }));
                                addLog(`伺服电机 ${servoDetail.id} 停止 (readServo)`);
                              } catch (e) {
                                addLog(`伺服电机停止失败: ${e?.message || String(e)}`);
                              }
                            }}
                          >
                            停止
                          </button>
                          <button
                            style={{ marginLeft: 8 }}
                            onClick={() => {
                              updateCurrentProjectData((d) => ({
                                ...d,
                                calibration: {
                                  ...(d.calibration || {}),
                                  servoConfig: {
                                    ...(d.calibration?.servoConfig || {}),
                                    [servoDetail.id]: {
                                      mode: servoDetail.mode,
                                      min: servoDetail.min,
                                      max: servoDetail.max,
                                      maxSpeed: servoDetail.maxSpeed ?? 1000,
                                      reverse: Boolean(servoDetail.reverse),
                                    },
                                  },
                                },
                              }));
                              addLog(`Saved servo ${servoDetail.id} config`);
                            }}
                          >
                            Save settings
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {motorDetail && (
                  <div style={{ marginTop: 12, padding: 12, border: '1px solid #ddd', borderRadius: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <h3 style={{ margin: 0 }}>已选择电机 ID{motorDetail.id}</h3>
                      <button onClick={closeMotorPanel}>关闭</button>
                    </div>

                    <div style={{ marginTop: 8, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                      <label>
                        <input
                          type="radio"
                          checked={motorDetail.dir === 'ccw'}
                          onChange={() => setMotorDetail((prev) => ({ ...prev, dir: 'ccw' }))}
                        />{' '}
                        逆时针
                      </label>
                      <label>
                        <input
                          type="radio"
                          checked={motorDetail.dir === 'cw'}
                          onChange={() => setMotorDetail((prev) => ({ ...prev, dir: 'cw' }))}
                        />{' '}
                        顺时针
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={Boolean(motorDetail.reverse)}
                          onChange={(e) => setMotorDetail((prev) => ({ ...prev, reverse: e.target.checked }))}
                      />{' '}
                        反转
                      </label>
                      <label>
                        最大速度 (1-150){' '}
                        <input
                          type="number"
                          style={{ width: 90 }}
                          value={motorDetail.maxSpeed ?? 150}
                          onChange={(e) =>
                            setMotorDetail((prev) => {
                              const ms = Math.max(1, Math.min(150, Number(e.target.value)));
                              return { ...prev, maxSpeed: ms, speed: Math.min(prev.speed ?? ms, ms) };
                            })
                          }
                        />
                      </label>
                      <label>
                        持续时间 ms (0-6000){' '}
                        <input
                          type="number"
                          style={{ width: 100 }}
                          value={motorDetail.durationMs ?? 1000}
                          onChange={(e) => setMotorDetail((prev) => ({ ...prev, durationMs: Math.max(0, Math.min(6000, Number(e.target.value))) }))}
                        />
                      </label>
                    </div>
                    <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span>0</span>
                      <input
                        type="range"
                        min={0}
                        max={motorDetail.maxSpeed ?? 150}
                        value={motorDetail.speed ?? 0}
                        onChange={(e) =>
                          setMotorDetail((prev) => ({
                            ...prev,
                            speed: Math.max(0, Math.min(prev.maxSpeed ?? 150, Number(e.target.value))),
                          }))
                        }
                        style={{ flex: 1 }}
                      />
                      <span>{motorDetail.maxSpeed ?? 150}</span>
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <button
                        onClick={async () => {
                          if (!ipc) return;
                          try {
                            const effectiveDir = motorDetail.reverse ? (motorDetail.dir === 'cw' ? 'ccw' : 'cw') : motorDetail.dir;
                            await ipc.invoke('jimu:rotateMotor', {
                              id: motorDetail.id,
                              dir: effectiveDir,
                              speed: motorDetail.speed ?? 0,
                              maxSpeed: motorDetail.maxSpeed ?? 150,
                              durationMs: motorDetail.durationMs ?? 1000,
                            });
                            addLog(
                              `电机 ${motorDetail.id} 旋转 dir=${effectiveDir} speed=${motorDetail.speed} dur=${motorDetail.durationMs}ms`,
                            );
                          } catch (e) {
                            addLog(`电机旋转失败: ${e?.message || String(e)}`);
                          }
                        }}
                      >
                        测试旋转
                      </button>
                      <button
                        style={{ marginLeft: 8 }}
                        onClick={async () => {
                          if (!ipc) return;
                          try {
                            const effectiveDir = motorDetail.reverse ? (motorDetail.dir === 'cw' ? 'ccw' : 'cw') : motorDetail.dir;
                            await ipc.invoke('jimu:rotateMotor', {
                              id: motorDetail.id,
                              dir: effectiveDir,
                              speed: 0,
                              maxSpeed: motorDetail.maxSpeed ?? 150,
                              durationMs: motorDetail.durationMs ?? 1000,
                            });
                            setMotorDetail((prev) => ({ ...prev, speed: 0 }));
                            addLog(`电机 ${motorDetail.id} 已停止`);
                          } catch (e) {
                            addLog(`电机停止失败: ${e?.message || String(e)}`);
                          }
                        }}
                      >
                        停止
                      </button>
                      <button
                        style={{ marginLeft: 8 }}
                        onClick={() => {
                          updateCurrentProjectData((d) => ({
                            ...d,
                            calibration: {
                              ...(d.calibration || {}),
                              motorConfig: {
                                ...(d.calibration?.motorConfig || {}),
                                [motorDetail.id]: {
                                  maxSpeed: motorDetail.maxSpeed ?? 150,
                                  reverse: Boolean(motorDetail.reverse),
                                },
                              },
                            },
                          }));
                          addLog(`Saved motor ${motorDetail.id} config`);
                        }}
                      >
                        Save settings
                      </button>
                    </div>
                  </div>
                )}

                {eyeDetail && (
                  <div style={{ marginTop: 12, padding: 12, border: '1px solid #ddd', borderRadius: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <h3 style={{ margin: 0 }}>已选择眼睛 ID{eyeDetail.id}</h3>
                      <button onClick={closeEyePanel}>关闭</button>
                    </div>

                    <div style={{ marginTop: 8, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          颜色选择器
                          <input
                            type="color"
                            value={eyeDetail.hex}
                            onChange={(e) => {
                              const rgb = hexToRgb(e.target.value);
                              setEyeDetail((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      hex: e.target.value,
                                      r: rgb?.r ?? prev.r,
                                      g: rgb?.g ?? prev.g,
                                      b: rgb?.b ?? prev.b,
                                    }
                                  : prev,
                              );
                            }}
                            style={{ width: 44, height: 30, padding: 0, border: 'none', background: 'transparent' }}
                          />
                        </label>
                        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          十六进制
                          <input
                            type="text"
                            value={eyeDetail.hex}
                            onChange={(e) => {
                              const nextHex = e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`;
                              const rgb = hexToRgb(nextHex);
                              setEyeDetail((prev) =>
                                prev ? { ...prev, hex: nextHex, ...(rgb ? rgb : {}) } : prev,
                              );
                            }}
                            style={{ width: 90 }}
                            placeholder="#RRGGBB"
                          />
                        </label>
                        {[
                          ['#ff0000', '红色'],
                          ['#00ff00', '绿色'],
                          ['#0000ff', '蓝色'],
                          ['#ffff00', '黄色'],
                          ['#ff00ff', '洋红色'],
                          ['#00ffff', '青色'],
                          ['#ffffff', '白色'],
                          ['#000000', '关闭'],
                        ].map(([hex, name]) => (
                          <button
                            key={hex}
                            type="button"
                            onClick={() => {
                              const rgb = hexToRgb(hex);
                              setEyeDetail((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      hex,
                                      r: rgb?.r ?? prev.r,
                                      g: rgb?.g ?? prev.g,
                                      b: rgb?.b ?? prev.b,
                                    }
                                  : prev,
                              );
                            }}
                            style={{
                              width: 22,
                              height: 22,
                              padding: 0,
                              borderRadius: 6,
                              border: '1px solid #bbb',
                              background: hex,
                              cursor: 'pointer',
                            }}
                            title={name}
                          />
                        ))}
                      </div>
                      <label>
                        R{' '}
                        <input
                          type="number"
                          style={{ width: 70 }}
                          min={0}
                          max={255}
                          value={eyeDetail.r}
                          onChange={(e) =>
                            setEyeDetail((prev) => {
                              if (!prev) return prev;
                              const r = clampByte(Number(e.target.value));
                              return { ...prev, r, hex: rgbToHex(r, prev.g, prev.b) };
                            })
                          }
                        />
                      </label>
                      <label>
                        G{' '}
                        <input
                          type="number"
                          style={{ width: 70 }}
                          min={0}
                          max={255}
                          value={eyeDetail.g}
                          onChange={(e) =>
                            setEyeDetail((prev) => {
                              if (!prev) return prev;
                              const g = clampByte(Number(e.target.value));
                              return { ...prev, g, hex: rgbToHex(prev.r, g, prev.b) };
                            })
                          }
                        />
                      </label>
                      <label>
                        B{' '}
                        <input
                          type="number"
                          style={{ width: 70 }}
                          min={0}
                          max={255}
                          value={eyeDetail.b}
                          onChange={(e) =>
                            setEyeDetail((prev) => {
                              if (!prev) return prev;
                              const b = clampByte(Number(e.target.value));
                              return { ...prev, b, hex: rgbToHex(prev.r, prev.g, b) };
                            })
                          }
                        />
                      </label>
                      <div style={{ width: 18, height: 18, borderRadius: 4, border: '1px solid #ccc', background: eyeDetail.hex }} />
                    </div>

                    <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      <button
                        onClick={async () => {
                          if (!ipc) return;
                          await stopEyeAnimation();
                          const eyesMask = 1 << (eyeDetail.id - 1);
                          try {
                            await ipc.invoke('jimu:setEyeColor', {
                              eyesMask,
                              time: 0xff,
                              r: eyeDetail.r,
                              g: eyeDetail.g,
                              b: eyeDetail.b,
                            });
                            addLog(`眼睛 ${eyeDetail.id} 设置 rgb=${eyeDetail.r},${eyeDetail.g},${eyeDetail.b}`);
                          } catch (e) {
                            addLog(`眼睛设置颜色失败: ${e?.message || String(e)}`);
                          }
                        }}
                      >
                        测试颜色
                      </button>
                      <button
                        onClick={async () => {
                          if (!ipc) return;
                          await stopEyeAnimation();
                          const eyesMask = 1 << (eyeDetail.id - 1);
                          try {
                            await ipc.invoke('jimu:setEyeOff', { eyesMask });
                            addLog(`眼睛 ${eyeDetail.id} 已关闭`);
                          } catch (e) {
                            addLog(`眼睛关闭失败: ${e?.message || String(e)}`);
                          }
                        }}
                      >
                        关闭
                      </button>
                    </div>

                    <div style={{ marginTop: 12, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                      <label>
                        动画{' '}
                        <select
                          value={eyeDetail.anim}
                          onChange={(e) => setEyeDetail((prev) => (prev ? { ...prev, anim: e.target.value } : prev))}
                        >
                          <option value="none">无</option>
                          <option value="blink">眨眼</option>
                          <option value="pulse">脉冲</option>
                          <option value="rainbow">彩虹</option>
                        </select>
                      </label>
                      <label>
                        速度 ms{' '}
                        <input
                          type="number"
                          min={40}
                          max={2000}
                          style={{ width: 90 }}
                          value={eyeDetail.speedMs}
                          onChange={(e) =>
                            setEyeDetail((prev) =>
                              prev ? { ...prev, speedMs: Math.max(40, Math.min(2000, Number(e.target.value))) } : prev,
                            )
                          }
                        />
                      </label>
                      <button
                        onClick={async () => {
                          if (!ipc) return;
                          await stopEyeAnimation();
                          const eyesMask = 1 << (eyeDetail.id - 1);
                          const anim = eyeDetail.anim;
                          if (anim === 'none') return;
                          let cancelled = false;
                          eyeAnimCancelRef.current = () => {
                            cancelled = true;
                          };
                          const base = { r: eyeDetail.r, g: eyeDetail.g, b: eyeDetail.b };
                          const stepMs = Math.max(40, eyeDetail.speedMs ?? 250);
                          try {
                            if (anim === 'blink') {
                              while (!cancelled) {
                                await ipc.invoke('jimu:setEyeColor', { eyesMask, time: 0xff, ...base });
                                await sleep(stepMs);
                                await ipc.invoke('jimu:setEyeOff', { eyesMask });
                                await sleep(stepMs);
                              }
                            } else if (anim === 'pulse') {
                              let t = 0;
                              while (!cancelled) {
                                t += 1;
                                const k = (Math.sin(t / 6) + 1) / 2;
                                const r = clampByte(base.r * k);
                                const g = clampByte(base.g * k);
                                const b = clampByte(base.b * k);
                                await ipc.invoke('jimu:setEyeColor', { eyesMask, time: 0xff, r, g, b });
                                await sleep(stepMs);
                              }
                            } else if (anim === 'rainbow') {
                              let hue = 0;
                              while (!cancelled) {
                                hue = (hue + 12) % 360;
                                const c = 1;
                                const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
                                let r1 = 0, g1 = 0, b1 = 0;
                                if (hue < 60) [r1, g1, b1] = [c, x, 0];
                                else if (hue < 120) [r1, g1, b1] = [x, c, 0];
                                else if (hue < 180) [r1, g1, b1] = [0, c, x];
                                else if (hue < 240) [r1, g1, b1] = [0, x, c];
                                else if (hue < 300) [r1, g1, b1] = [x, 0, c];
                                else [r1, g1, b1] = [c, 0, x];
                                await ipc.invoke('jimu:setEyeColor', {
                                  eyesMask,
                                  time: 0xff,
                                  r: clampByte(r1 * 255),
                                  g: clampByte(g1 * 255),
                                  b: clampByte(b1 * 255),
                                });
                                await sleep(stepMs);
                              }
                            }
                          } finally {
                            eyeAnimCancelRef.current = null;
                          }
                        }}
                      >
                        开始
                      </button>
                      <button
                        onClick={async () => {
                          await stopEyeAnimation();
                          if (!ipc || !eyeDetail) return;
                          const eyesMask = 1 << (eyeDetail.id - 1);
                          try {
                            await ipc.invoke('jimu:setEyeOff', { eyesMask });
                          } catch (_) {
                          }
                        }}
                      >
                        Stop
                      </button>
                    </div>
                  </div>
                )}

                {irPanel.open && modules?.ir?.length ? (
                  <div style={{ marginTop: 12, padding: 12, border: '1px solid #ddd', borderRadius: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <h3 style={{ margin: 0 }}>红外传感器</h3>
                      <button onClick={() => setIrPanel({ open: false, live: false })}>关闭</button>
                    </div>
                    <div style={{ marginTop: 8, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                      <label>
                        <input
                          type="checkbox"
                          checked={Boolean(irPanel.live)}
                          onChange={(e) => setIrPanel((prev) => ({ ...prev, live: e.target.checked }))}
                        />{' '}
                        实时 (5Hz)
                      </label>
                      <button
                        onClick={async () => {
                          if (!ipc) return;
                          try {
                            const res = await ipc.invoke('jimu:readSensors');
                            if (res?.error) setSensorError(res.message || '传感器读取失败');
                          } catch (e) {
                            setSensorError(e?.message || String(e));
                          }
                        }}
                      >
                        读取一次
                      </button>
                      {sensorError && <span style={{ color: '#b71c1c' }}>错误: {sensorError}</span>}
                    </div>
                    <div style={{ marginTop: 10, padding: 10, border: '1px solid #eee', borderRadius: 8 }}>
                      <div style={{ display: 'grid', gap: 4 }}>
                        {(modules?.ir?.length ? modules.ir : []).map((id) => {
                          const r = sensorReadings.ir?.[id];
                          return (
                            <div key={`ir-row-${id}`}>{`红外 ${id}: ${r?.raw != null ? r.raw : '无'}`}</div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ) : null}

                {usPanel.open && modules?.ultrasonic?.length ? (
                  <div style={{ marginTop: 12, padding: 12, border: '1px solid #ddd', borderRadius: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <h3 style={{ margin: 0 }}>超声波传感器</h3>
                      <button
                        onClick={async () => {
                          await turnOffUltrasonicLeds(modules?.ultrasonic);
                          setUsPanel((prev) => ({ ...prev, open: false, live: false }));
                        }}
                      >
                        关闭
                      </button>
                    </div>
                    <div style={{ marginTop: 8, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                      <label>
                        <input
                          type="checkbox"
                          checked={Boolean(usPanel.live)}
                          onChange={(e) => setUsPanel((prev) => ({ ...prev, live: e.target.checked }))}
                      />{' '}
                        实时 (5Hz)
                      </label>
                      <button
                        onClick={async () => {
                          if (!ipc) return;
                          try {
                            const res = await ipc.invoke('jimu:readSensors');
                            if (res?.error) setSensorError(res.message || '传感器读取失败');
                          } catch (e) {
                            setSensorError(e?.message || String(e));
                          }
                        }}
                      >
                        读取一次
                      </button>
                      {sensorError && <span style={{ color: '#b71c1c' }}>错误: {sensorError}</span>}
                    </div>

                    <div style={{ marginTop: 10, padding: 10, border: '1px solid #eee', borderRadius: 8 }}>
                      <strong>读数</strong>
                      <div style={{ marginTop: 6, display: 'grid', gap: 4 }}>
                        {(modules?.ultrasonic?.length ? modules.ultrasonic : []).map((id) => {
                          const r = sensorReadings.us?.[id];
                          const raw = r?.raw;
                          const cm = raw == null ? null : raw === 0 ? 301.0 : raw / 10;
                          return (
                            <div key={`us-row-${id}`}>{`超声波 ${id}: ${cm == null ? '无' : `${cm.toFixed(1)} cm`}`}</div>
                          );
                        })}
                      </div>
                    </div>

                    <div style={{ marginTop: 10, padding: 10, border: '1px solid #eee', borderRadius: 8 }}>
                      <strong>超声波 LED</strong>
                      <div style={{ marginTop: 8, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                        <label>
                          传感器 ID{' '}
                          <select
                            value={usPanel.led.id}
                            onChange={(e) =>
                              setUsPanel((prev) => ({ ...prev, led: { ...prev.led, id: Number(e.target.value) } }))
                            }
                          >
                            {(modules?.ultrasonic?.length ? modules.ultrasonic : []).map((id) => (
                              <option key={`us-opt-${id}`} value={id}>
                                {id}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          颜色选择器
                          <input
                            type="color"
                            value={usPanel.led.hex}
                            onChange={(e) => {
                              const rgb = hexToRgb(e.target.value);
                              setUsPanel((prev) => ({
                                ...prev,
                                led: {
                                  ...prev.led,
                                  hex: e.target.value,
                                  r: rgb?.r ?? prev.led.r,
                                  g: rgb?.g ?? prev.led.g,
                                  b: rgb?.b ?? prev.led.b,
                                },
                              }));
                            }}
                            style={{ width: 44, height: 30, padding: 0, border: 'none', background: 'transparent' }}
                          />
                        </label>
                        <button
                          onClick={async () => {
                            if (!ipc) return;
                            try {
                              await ipc.invoke('jimu:setUltrasonicLed', {
                                id: usPanel.led.id,
                                r: usPanel.led.r,
                                g: usPanel.led.g,
                                b: usPanel.led.b,
                              });
                              addLog(`超声波 ${usPanel.led.id} LED rgb=${usPanel.led.r},${usPanel.led.g},${usPanel.led.b}`);
                            } catch (e) {
                              addLog(`超声波 LED 设置失败: ${e?.message || String(e)}`);
                            }
                          }}
                        >
                          测试 LED
                        </button>
                        <button
                          onClick={async () => {
                            if (!ipc) return;
                            try {
                              await ipc.invoke('jimu:setUltrasonicLedOff', { id: usPanel.led.id });
                              addLog(`超声波 ${usPanel.led.id} LED 已关闭`);
                            } catch (e) {
                              addLog(`超声波 LED 关闭失败: ${e?.message || String(e)}`);
                            }
                          }}
                        >
                          关闭
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}
              </Section>
            </>
          )}

          {tab === 'routines' && (
            <Section style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', marginBottom: 0 }}>
              <RoutinesTab
                ref={routinesRef}
                ipc={ipc}
                projectId={currentProject?.id}
                status={status}
                selectedBrickId={selectedBrickId}
                connectToSelectedBrick={handleConnect}
                calibration={currentProject?.data?.calibration || {}}
                projectModules={currentProject?.data?.hardware?.modules || {}}
                controllerData={currentProject?.data?.controller || EMPTY_CONTROLLER}
                projectRoutines={currentProject?.data?.routines}
                onUpdateProjectData={updateCurrentProjectData}
                routineXmlRamCacheRef={routineXmlRamCacheRef}
                battery={battery}
                addLog={addLog}
              />
            </Section>
          )}

          {tab === 'voice' && (
            <Section style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', marginBottom: 0 }}>
              <VoiceRecognitionTab
                ref={voiceRef}
                ipc={ipc}
                status={status}
                addLog={addLog}
              />
            </Section>
          )}

          {tab === 'control' && (
            <Section style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', marginBottom: 0 }}>
              <RemoteControlTab
                ref={controlRef}
                ipc={ipc}
                status={status}
                addLog={addLog}
              />
            </Section>
          )}

        </div>
      )}
    </div>
  );
}
