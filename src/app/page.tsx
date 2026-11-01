'use client';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Float, Line } from '@react-three/drei';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  Copy,
  Download,
  MousePointer2,
  Pause,
  Play,
  RotateCcw,
} from 'lucide-react';
import * as THREE from 'three';
import {
  cm360,
  candidates,
  degreesPerMouseInput,
  edpi,
  recommend,
  score as trialScore,
  type Observation,
  type Trial,
} from '@/lib/calibration';
import { useCalibration, type SensitivityHistoryEntry } from '@/lib/store';

type View = 'home' | 'setup' | 'trainer' | 'results';
type Theme = 'lime' | 'blue' | 'coral' | 'violet';
const themeColors: Record<Theme, string> = {
  lime: '#d7ff4f',
  blue: '#62d9ff',
  coral: '#ff735e',
  violet: '#b99aff',
};
function shuffle<T>(items: T[]) {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function orderForBlock<T>(pool: T[], block: number) {
  if (!pool.length) return [];
  const offset = block % pool.length;
  return [...pool.slice(offset), ...pool.slice(0, offset)];
}

const modes = [
  { id: 'horizontal', name: 'HORIZONTAL FLICKS', desc: 'Alternating left and right.' },
  { id: 'micro', name: 'MICRO ADJUSTMENTS', desc: 'Small targets. Deliberate control.' },
  { id: 'wide', name: 'WIDE FLICKS', desc: 'Longer transfers. Stay composed.' },
  { id: 'tracking', name: 'TARGET TRACKING', desc: 'Follow the movement. Keep it centered.' },
  {
    id: 'tracking-duration',
    name: '20-SECOND TRACKING',
    desc: 'Keep the crosshair on the moving ball. Do not click.',
  },
];

function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function summarizeExercise(trials: Trial[], modeId: string, sensitivity: number) {
  const records = trials.filter((trial) => trial.mode === modeId && trial.sens === sensitivity);
  const observations = records.flatMap((trial) => trial.observations ?? []);
  const centerScores = observations.flatMap((observation) =>
    typeof observation.centerAccuracy === 'number' ? [observation.centerAccuracy] : [],
  );
  const hits = records.reduce((sum, trial) => sum + trial.hits, 0);
  const shots = records.reduce((sum, trial) => sum + trial.shots, 0);
  return {
    score: mean(records.map(trialScore)) ?? 0,
    centerAccuracy: mean(centerScores),
    hitRate: shots ? (hits / shots) * 100 : null,
    averageTime: mean(records.flatMap((trial) => trial.times)),
  };
}

function getAimProfile(exerciseScores: Record<string, number>) {
  const groups = [
    { id: 'flick', name: 'FLICK CONTROL', exercises: ['horizontal', 'wide'] },
    { id: 'precision', name: 'PRECISION AIM', exercises: ['micro'] },
    { id: 'tracking', name: 'TRACKING AIM', exercises: ['tracking', 'tracking-duration'] },
  ]
    .map((group) => {
      const scores = group.exercises.flatMap((exercise) =>
        typeof exerciseScores[exercise] === 'number' ? [exerciseScores[exercise]] : [],
      );
      return { ...group, score: mean(scores) };
    })
    .filter((group): group is typeof group & { score: number } => group.score !== null)
    .sort((a, b) => b.score - a.score);
  if (groups.length < 2) {
    return {
      title: 'PROFILE IN PROGRESS',
      summary: 'Complete more exercises to reveal your strongest aim style.',
      strongest: groups[0] ?? null,
      growthArea: null,
      groups,
    };
  }
  const strongest = groups[0];
  const growthArea = groups[groups.length - 1];
  const balanced = strongest.score - growthArea.score < 0.05;
  return {
    title: balanced ? 'ALL-ROUND AIM' : strongest.name,
    summary: balanced
      ? 'Your scores are close across flicking, precision, and tracking.'
      : `Your strongest area is ${strongest.name.toLowerCase()}; ${growthArea.name.toLowerCase()} has the most room to grow.`,
    strongest,
    growthArea,
    groups,
  };
}

function Target({
  position,
  size,
  color = '#fff',
  centerMarker = false,
}: {
  position: [number, number, number];
  size: number;
  color?: string;
  centerMarker?: boolean;
}) {
  return (
    <mesh position={position}>
      <sphereGeometry args={[size, 16, 16]} />
      <meshBasicMaterial color={color} />
      {centerMarker && (
        <mesh position={[0, 0, 0]} renderOrder={10} raycast={() => {}}>
          <circleGeometry args={[size * 0.095, 16]} />
          <meshBasicMaterial color="#ff3b30" depthTest={false} depthWrite={false} />
        </mesh>
      )}
      <mesh position={[0, 0, -0.03]} raycast={() => {}}>
        <sphereGeometry args={[size * 1.5, 12, 12]} />
        <meshBasicMaterial color={color} transparent opacity={0.12} />
      </mesh>
    </mesh>
  );
}

function CursorMarker() {
  const markerRef = useRef<THREE.Group>(null);
  const cursorPosition = useRef(new THREE.Vector3(1.5, 0.72, 0.1));

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const x = (event.clientX / window.innerWidth) * 2 - 1;
      const y = 1 - (event.clientY / window.innerHeight) * 2;
      const radius = Math.hypot(x, y);
      const scale = radius > 1 ? 1 / radius : 1;
      cursorPosition.current.set(x * 1.4 * scale, y * 1.4 * scale, 0.1);
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    return () => window.removeEventListener('pointermove', onPointerMove);
  }, []);

  useFrame(() => {
    if (markerRef.current) markerRef.current.position.copy(cursorPosition.current);
  });

  return (
    <group ref={markerRef}>
      <Target position={[0, 0, 0]} size={0.11} />
    </group>
  );
}

function Scene({
  target,
  onHit,
  onMiss,
  paused,
  tracking,
  trackingOnly,
  onTrackingSample,
  onPointerCaptured,
  onPointerLockChange,
  sensitivity,
  dpi,
  rawCounts,
  onRawInputChange,
  angleRef,
}: {
  target: { position: [number, number, number]; size: number } | null;
  onHit: (centerAccuracy: number) => void;
  onMiss: () => void;
  paused: boolean;
  tracking: boolean;
  trackingOnly: boolean;
  onTrackingSample: (centerAccuracy: number) => void;
  onPointerCaptured: () => void;
  onPointerLockChange: (locked: boolean) => void;
  sensitivity: number;
  dpi: number;
  rawCounts: boolean;
  onRawInputChange: (raw: boolean) => void;
  angleRef: React.MutableRefObject<number>;
}) {
  const { camera, invalidate } = useThree();
  const targetRef = useRef<THREE.Group>(null);
  const trackingOrigin = useRef(new THREE.Vector3());
  const trackingElapsed = useRef(0);
  const trackingSampleElapsed = useRef(0);
  const trackingRaycaster = useRef(new THREE.Raycaster());
  const pendingMovement = useRef({ x: 0, y: 0 });
  const renderRequested = useRef(false);
  const screenCenter = useMemo(() => new THREE.Vector2(0, 0), []);
  const latest = useRef({
    target,
    paused,
    tracking,
    trackingOnly,
    onHit,
    onMiss,
    onTrackingSample,
    onPointerCaptured,
    onPointerLockChange,
    sensitivity,
    dpi,
    rawCounts,
    onRawInputChange,
  });
  latest.current = {
    target,
    paused,
    tracking,
    trackingOnly,
    onHit,
    onMiss,
    onTrackingSample,
    onPointerCaptured,
    onPointerLockChange,
    sensitivity,
    dpi,
    rawCounts,
    onRawInputChange,
  };
  const applyPendingMovement = useCallback(() => {
    const {
      paused: isPaused,
      sensitivity: currentSens,
      dpi: currentDpi,
      rawCounts: useRawCounts,
    } = latest.current;
    if (isPaused) {
      pendingMovement.current.x = 0;
      pendingMovement.current.y = 0;
      return;
    }
    const { x, y } = pendingMovement.current;
    if (x === 0 && y === 0) return;
    pendingMovement.current.x = 0;
    pendingMovement.current.y = 0;
    const radiansPerInput =
      (degreesPerMouseInput(currentSens, currentDpi, useRawCounts) * Math.PI) / 180;
    const yawDelta = -x * radiansPerInput;
    angleRef.current += yawDelta;
    camera.rotation.y += yawDelta;
    camera.rotation.x = Math.max(-1.25, Math.min(1.25, camera.rotation.x - y * radiansPerInput));
  }, [angleRef, camera]);
  useEffect(() => {
    camera.rotation.order = 'YXZ';
  }, [camera]);
  useEffect(() => {
    const c = document.querySelector('.arena-canvas') as HTMLElement | null;
    if (!c) return;
    const raycaster = new THREE.Raycaster();
    const center = new THREE.Vector2(0, 0);
    const requestLock = () => {
      try {
        const result = c.requestPointerLock({ unadjustedMovement: true });
        Promise.resolve(result)
          .then(() => latest.current.onRawInputChange(true))
          .catch(() => {
            latest.current.onRawInputChange(false);
            c.requestPointerLock?.();
          });
      } catch {
        latest.current.onRawInputChange(false);
        c.requestPointerLock?.();
      }
    };
    const onLockChange = () => {
      const locked = document.pointerLockElement === c;
      if (!locked) {
        pendingMovement.current.x = 0;
        pendingMovement.current.y = 0;
      }
      latest.current.onPointerLockChange(locked);
      if (locked) latest.current.onPointerCaptured();
      else latest.current.onRawInputChange(false);
      invalidate();
    };
    const onMouseDown = (e: MouseEvent) => {
      const state = latest.current;
      if (state.paused) return;
      if (document.pointerLockElement !== c) {
        requestLock();
        return;
      }
      if (state.trackingOnly) return;
      if (e.button !== 0) return;
      if (!targetRef.current || !state.target) {
        state.onMiss();
        return;
      }
      applyPendingMovement();
      raycaster.setFromCamera(center, camera);
      const targetHits = raycaster.intersectObject(targetRef.current, true);
      if (targetHits.length) {
        const targetCenter = targetRef.current.getWorldPosition(new THREE.Vector3());
        const centerOffset = raycaster.ray.distanceToPoint(targetCenter);
        const centerAccuracy = Math.max(0, 100 * (1 - centerOffset / state.target.size));
        state.onHit(centerAccuracy);
      } else state.onMiss();
    };
    const onMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== c || latest.current.paused) return;
      pendingMovement.current.x += e.movementX;
      pendingMovement.current.y += e.movementY;
      if (!renderRequested.current) {
        renderRequested.current = true;
        invalidate();
      }
    };
    c.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('pointerlockchange', onLockChange);
    return () => {
      c.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('pointerlockchange', onLockChange);
    };
  }, [camera, invalidate, applyPendingMovement]);
  useEffect(() => {
    if (!target || !targetRef.current) return;
    const initial = new THREE.Vector3(...target.position)
      .applyQuaternion(camera.quaternion)
      .add(camera.position);
    targetRef.current.position.copy(initial);
    trackingOrigin.current.copy(initial);
    trackingElapsed.current = 0;
    trackingSampleElapsed.current = 0;
    invalidate();
  }, [target, camera, invalidate]);
  useFrame((_, delta) => {
    renderRequested.current = false;
    applyPendingMovement();
    const state = latest.current;
    if (targetRef.current && !state.paused && state.tracking) {
      trackingElapsed.current += delta;
      const elapsed = trackingElapsed.current * (state.trackingOnly ? 1.35 : 1);
      targetRef.current.position.x = trackingOrigin.current.x + Math.sin(elapsed * 1.25) * 1.4;
      targetRef.current.position.y = trackingOrigin.current.y + Math.sin(elapsed * 0.8) * 0.45;
      if (state.trackingOnly) {
        trackingSampleElapsed.current += delta;
        if (trackingSampleElapsed.current >= 0.1) {
          trackingSampleElapsed.current %= 0.1;
          trackingRaycaster.current.setFromCamera(screenCenter, camera);
          const targetCenter = targetRef.current.getWorldPosition(new THREE.Vector3());
          const centerOffset = trackingRaycaster.current.ray.distanceToPoint(targetCenter);
          const centerAccuracy = Math.max(0, 100 * (1 - centerOffset / (state.target?.size ?? 1)));
          state.onTrackingSample(centerAccuracy);
        }
      }
    }
  });
  return (
    <>
      <color attach="background" args={['#101010']} />
      <fog attach="fog" args={['#101010', 13, 34]} />
      <gridHelper args={[100, 36, '#252525', '#1c1c1c']} position={[0, -3, -2]} />
      <mesh position={[0, 0, -12]}>
        <planeGeometry args={[200, 100]} />
        <meshBasicMaterial color="#111" />
      </mesh>
      {target && (
        <group ref={targetRef}>
          <Target position={[0, 0, 0]} size={target.size} centerMarker />
        </group>
      )}
    </>
  );
}
export default function Home() {
  const missTimer = useRef<number | undefined>(undefined);
  const finishTargetRef = useRef<(hit: boolean, centerAccuracy?: number) => void>(() => {});
  const spawnRef = useRef<() => void>(() => {});
  const trackingSamplesRef = useRef<number[]>([]);
  const trackingRemainingRef = useRef(20_000);
  const awaitingCaptureRef = useRef(false);
  const resultCardRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<View>('home'),
    [testLength, setTestLength] = useState<'quick' | 'long' | 'longest'>('quick'),
    [confirmationRun, setConfirmationRun] = useState(false),
    [blockIndex, setBlockIndex] = useState(0),
    [modeIndex, setModeIndex] = useState(0),
    [candidateIndex, setCandidateIndex] = useState(0),
    [candidatePool, setCandidatePool] = useState<number[]>([]),
    [candidateOrder, setCandidateOrder] = useState<number[]>([]),
    [target, setTarget] = useState<{ position: [number, number, number]; size: number } | null>(
      null,
    ),
    [paused, setPaused] = useState(false),
    [waitingForCapture, setWaitingForCapture] = useState(false),
    [pointerLocked, setPointerLocked] = useState(false),
    [trackingRemaining, setTrackingRemaining] = useState(20),
    [completedAt, setCompletedAt] = useState<Date | null>(null),
    [cardActionMessage, setCardActionMessage] = useState(''),
    [rawCounts, setRawCounts] = useState(false),
    [count, setCount] = useState(0),
    [trialStart, setTrialStart] = useState(0),
    [startAngle, setStartAngle] = useState(0),
    [errors, setErrors] = useState<number[]>([]),
    [times, setTimes] = useState<number[]>([]),
    [observations, setObservations] = useState<Observation[]>([]),
    [hits, setHits] = useState(0),
    [shots, setShots] = useState(0),
    [corrections, setCorrections] = useState(0),
    [overshoots, setOvershoots] = useState(0),
    [undershoots, setUndershoots] = useState(0),
    [copied, setCopied] = useState(false);
  const angleRef = useRef(0);
  const hitAudioContext = useRef<AudioContext | null>(null);
  const hitSoundEnabled = useRef(true);
  const {
    settings,
    trials,
    history,
    personalBests,
    setSettings,
    addTrial,
    clearTrials,
    addHistoryEntry,
    removeHistoryEntry,
    clearHistory,
    clearPersonalBests,
  } = useCalibration();
  const savedHistorySession = useRef<number | null>(null);
  const [calculatorDpi, setCalculatorDpi] = useState('800');
  const [calculatorSens, setCalculatorSens] = useState('1');
  const [theme, setTheme] = useState<Theme>('lime');
  useEffect(() => {
    const saved = localStorage.getItem('senslab-theme');
    if (saved && Object.hasOwn(themeColors, saved)) setTheme(saved as Theme);
  }, []);
  const changeTheme = (value: string) => {
    if (Object.hasOwn(themeColors, value)) {
      setTheme(value as Theme);
      localStorage.setItem('senslab-theme', value);
    }
  };
  const [soundEnabled, setSoundEnabled] = useState(true);
  useEffect(() => {
    const enabled = localStorage.getItem('senslab-hit-sound') !== 'false';
    hitSoundEnabled.current = enabled;
    setSoundEnabled(enabled);
  }, []);
  const [dpiInput, setDpiInput] = useState(String(settings.dpi));
  const [sensInput, setSensInput] = useState(String(settings.sens));
  const [pollingInput, setPollingInput] = useState(String(settings.polling));
  const [refreshInput, setRefreshInput] = useState(String(settings.refresh));
  useEffect(() => {
    setDpiInput(String(settings.dpi));
  }, [settings.dpi]);
  useEffect(() => {
    setPollingInput(String(settings.polling));
  }, [settings.polling]);
  useEffect(() => {
    setRefreshInput(String(settings.refresh));
  }, [settings.refresh]);
  const commitSetting = (
    key: 'dpi' | 'sens' | 'polling' | 'refresh',
    value: string,
    setInput: (value: string) => void,
    min: number,
    max: number,
  ) => {
    const parsed = Number(value);
    if (value.trim() && Number.isFinite(parsed) && parsed >= min && parsed <= max) {
      setSettings({ ...settings, [key]: parsed });
    } else {
      setInput(String(settings[key]));
    }
  };
  const sensList = useMemo(() => candidates(settings.sens), [settings.sens]);
  const testSens =
    candidateOrder.length > 0
      ? candidateOrder
      : candidatePool.length > 0
        ? candidatePool
        : sensList;
  const blockTotal = confirmationRun
    ? 6
    : testLength === 'quick'
      ? 1
      : testLength === 'long'
        ? 3
        : 5;
  const repetitions = confirmationRun ? 4 : testLength === 'quick' ? 5 : 4;
  const sens = testSens[candidateIndex] ?? settings.sens;
  const mode = {
    ...modes[modeIndex],
    count: modes[modeIndex].id === 'tracking-duration' ? 1 : repetitions,
  };
  const finishTarget = (hit: boolean, centerAccuracy = 0) => {
    if (paused || !target) return;
    const timedTracking = mode.id === 'tracking-duration';
    const isTracking = mode.id === 'tracking' || timedTracking;
    const scoredHit = hit && !timedTracking;
    window.clearTimeout(missTimer.current);
    const elapsed = performance.now() - trialStart;
    const angular = (Math.atan2(target.position[0], 10) * 180) / Math.PI;
    const moved = angleRef.current - startAngle;
    const error = Math.abs(angular - moved);
    const wasOver =
      Math.sign(moved) === Math.sign(angular) && Math.abs(moved) > Math.abs(angular) + 1;
    const wasUnder =
      Math.sign(moved) !== Math.sign(angular) || Math.abs(moved) < Math.abs(angular) - 1;
    const observation: Observation = {
      hit: scoredHit,
      mode: mode.id,
      timeMs: elapsed,
      centerAccuracy: timedTracking ? centerAccuracy : hit ? centerAccuracy : 0,
      angularErrorDeg: scoredHit && !isTracking ? error : null,
      corrections: scoredHit && !isTracking && error > 3 ? 1 : 0,
      overshot: scoredHit && !isTracking && wasOver,
      undershot: scoredHit && !isTracking && wasUnder,
    };
    const nextObservations = [...observations, observation];
    setObservations(nextObservations);
    if (scoredHit) {
      setHits((h) => h + 1);
      setTimes((a) => [...a, elapsed]);
      if (!isTracking) setErrors((a) => [...a, error]);
      if (!isTracking && wasOver) setOvershoots((n) => n + 1);
      else if (!isTracking && wasUnder) setUndershoots((n) => n + 1);
      if (!isTracking && error > 3) setCorrections((n) => n + 1);
    }
    if (!timedTracking) setShots((s) => s + 1);
    setTarget(null);
    window.setTimeout(() => {
      const next = count + 1;
      setCount(next);
      if (next >= mode.count) {
        const hitCount = hits + (scoredHit ? 1 : 0),
          shotCount = shots + (timedTracking ? 0 : 1);
        const nextTrial: Trial = {
          sens,
          hits: hitCount,
          shots: shotCount,
          times: scoredHit ? [...times, elapsed] : times,
          errors: scoredHit && !isTracking ? [...errors, error] : errors,
          corrections: corrections + (scoredHit && !isTracking && error > 3 ? 1 : 0),
          overshoots: overshoots + (scoredHit && !isTracking && wasOver ? 1 : 0),
          undershoots: undershoots + (scoredHit && !isTracking && wasUnder ? 1 : 0),
          mode: mode.id,
          block: blockIndex,
          phase: confirmationRun ? 'confirmation' : 'screening',
          observations: nextObservations,
        };
        addTrial(nextTrial);
        setObservations([]);
        if (modeIndex < modes.length - 1) {
          setModeIndex((i) => i + 1);
          setCount(0);
          window.setTimeout(() => spawnRef.current(), 200);
        } else if (candidateIndex < testSens.length - 1) {
          setModeIndex(0);
          setCandidateIndex((i) => i + 1);
          setCount(0);
          window.setTimeout(() => spawnRef.current(), 200);
        } else if (blockIndex < blockTotal - 1) {
          const nextBlock = blockIndex + 1;
          setCandidateOrder(orderForBlock(candidatePool, nextBlock));
          setBlockIndex(nextBlock);
          setCandidateIndex(0);
          setModeIndex(0);
          setCount(0);
          window.setTimeout(() => spawnRef.current(), 200);
        } else {
          document.exitPointerLock?.();
          setCompletedAt(new Date());
          setView('results');
        }
      } else window.setTimeout(() => spawnRef.current(), 200);
    }, 260);
  };
  finishTargetRef.current = finishTarget;
  const record = (centerAccuracy: number) => {
    if (hitSoundEnabled.current && typeof window !== 'undefined' && window.AudioContext) {
      try {
        const audio = hitAudioContext.current ?? new window.AudioContext();
        hitAudioContext.current = audio;
        void audio.resume();
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        const now = audio.currentTime;
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(780, now);
        oscillator.frequency.exponentialRampToValueAtTime(520, now + 0.07);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.12, now + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.085);
        oscillator.connect(gain);
        gain.connect(audio.destination);
        oscillator.start(now);
        oscillator.stop(now + 0.09);
      } catch {
        // Audio is optional; target input should continue if the browser blocks sound.
      }
    }
    finishTargetRef.current(true, centerAccuracy);
  };
  const toggleSound = () => {
    const enabled = !soundEnabled;
    hitSoundEnabled.current = enabled;
    setSoundEnabled(enabled);
    localStorage.setItem('senslab-hit-sound', String(enabled));
  };
  const recordTrackingSample = (centerAccuracy: number) => {
    trackingSamplesRef.current.push(centerAccuracy);
  };
  const onPointerCaptured = () => {
    setPointerLocked(true);
    if (awaitingCaptureRef.current) {
      awaitingCaptureRef.current = false;
      setWaitingForCapture(false);
      spawnRef.current();
    } else {
      setTrialStart(performance.now());
    }
  };
  const onPointerLockChange = (locked: boolean) => setPointerLocked(locked);
  const spawn = () => {
    if (mode.id === 'tracking-duration') {
      trackingSamplesRef.current = [];
      trackingRemainingRef.current = 20_000;
      setTrackingRemaining(20);
    }
    const seed = blockIndex * 1009 + modeIndex * 97 + count + 1;
    const random = (salt: number) => {
      const value = Math.sin(seed * 12.9898 + salt * 78.233) * 43758.5453;
      return value - Math.floor(value);
    };
    const targetX =
      mode.id === 'horizontal'
        ? (count % 2 === 0 ? 1 : -1) * (1.2 + (count % 4) * 0.55)
        : mode.id === 'micro'
          ? (random(1) * 2 - 1) * 0.6
          : mode.id === 'tracking' || mode.id === 'tracking-duration'
            ? (random(1) * 2 - 1) * 1.5
            : (random(1) < 0.5 ? -1 : 1) * (3 + random(2) * 4);
    const targetY =
      (random(3) * 2 - 1) *
      (mode.id === 'micro'
        ? 0.35
        : mode.id === 'tracking' || mode.id === 'tracking-duration'
          ? 0.6
          : mode.id === 'wide'
            ? 1.3
            : 0.9);
    const scale = mode.id === 'micro' ? 0.22 : mode.id === 'wide' ? 1.15 : 0.55;
    const spawnDistance = Math.hypot(targetX, targetY);
    const spawnAngle = Math.atan2(targetY, targetX);
    const spawnRadius = Math.max(spawnDistance, 1.8);
    const pos: [number, number, number] = [
      Math.cos(spawnAngle) * spawnRadius,
      Math.sin(spawnAngle) * spawnRadius,
      -10,
    ];
    setTarget({ position: pos, size: scale });
    setTrialStart(performance.now());
    setStartAngle(angleRef.current);
  };
  spawnRef.current = spawn;
  useEffect(() => {
    if (view !== 'trainer' || paused || !pointerLocked || !target) return;
    if (mode.id === 'tracking-duration') {
      const startedAt = performance.now();
      const startingRemaining = trackingRemainingRef.current;
      const timer = window.setInterval(() => {
        const remaining = Math.max(0, startingRemaining - (performance.now() - startedAt));
        trackingRemainingRef.current = remaining;
        setTrackingRemaining(Math.ceil(remaining / 1000));
        if (remaining === 0) {
          window.clearInterval(timer);
          const samples = trackingSamplesRef.current;
          const accuracy = samples.length
            ? samples.reduce((sum, value) => sum + value, 0) / samples.length
            : 0;
          finishTargetRef.current(true, accuracy);
        }
      }, 100);
      return () => {
        window.clearInterval(timer);
        trackingRemainingRef.current = Math.max(
          0,
          startingRemaining - (performance.now() - startedAt),
        );
      };
    }
    missTimer.current = window.setTimeout(() => finishTargetRef.current(false), 2500);
    return () => window.clearTimeout(missTimer.current);
  }, [view, paused, pointerLocked, target, mode.id]);
  const unsupported = typeof window !== 'undefined' && !window.matchMedia('(pointer:fine)').matches;
  const resetSession = (pool: number[], isConfirmation: boolean) => {
    const randomizedPool = shuffle(pool);
    setConfirmationRun(isConfirmation);
    setCandidatePool(randomizedPool);
    setCandidateOrder(orderForBlock(randomizedPool, 0));
    setModeIndex(0);
    setBlockIndex(0);
    setCandidateIndex(0);
    setCount(0);
    setTarget(null);
    setHits(0);
    setShots(0);
    setErrors([]);
    setTimes([]);
    setObservations([]);
    setCorrections(0);
    setOvershoots(0);
    setUndershoots(0);
    setPaused(false);
    setPointerLocked(false);
    setWaitingForCapture(true);
    awaitingCaptureRef.current = true;
    trackingSamplesRef.current = [];
    trackingRemainingRef.current = 20_000;
    setTrackingRemaining(20);
    setCompletedAt(null);
    savedHistorySession.current = null;
    setCardActionMessage('');
    angleRef.current = 0;
    setTrialStart(0);
    setView('trainer');
  };
  const start = () => {
    if (unsupported) {
      setView('trainer');
      return;
    }
    clearTrials();
    resetSession(sensList, false);
  };
  useEffect(() => {
    if (view !== 'trainer') return;
    const onLockChange = () => {
      if (
        document.pointerLockElement === null &&
        !paused &&
        !awaitingCaptureRef.current &&
        document.visibilityState === 'visible'
      )
        setPaused(true);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPaused(true);
        document.exitPointerLock?.();
      }
    };
    const onBlur = () => {
      setPaused(true);
      document.exitPointerLock?.();
    };
    document.addEventListener('pointerlockchange', onLockChange);
    document.addEventListener('keydown', onKey);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('pointerlockchange', onLockChange);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onBlur);
    };
  }, [view, paused]);
  const analysisTrials = useMemo(
    () => (confirmationRun ? trials.filter((trial) => trial.phase === 'confirmation') : trials),
    [confirmationRun, trials],
  );
  const result = useMemo(
    () =>
      recommend(analysisTrials, settings.sens, {
        allowTwoCandidates: confirmationRun,
      }),
    [analysisTrials, confirmationRun, settings.sens],
  );
  const startConfirmation = () => {
    const topCandidates = result.ranked.slice(0, 2).map((row) => row.sens);
    if (topCandidates.length < 2) return;
    resetSession(topCandidates, true);
  };
  const centerAccuracy = useMemo(() => {
    const scores = analysisTrials.flatMap((trial) => {
      const observations = (trial.observations ?? []).flatMap((observation) =>
        typeof observation.centerAccuracy === 'number' ? [observation.centerAccuracy] : [],
      );
      return observations.length
        ? [observations.reduce((sum, value) => sum + value, 0) / observations.length]
        : [];
    });
    return scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : null;
  }, [analysisTrials]);
  const screeningTrials = useMemo(
    () => trials.filter((trial) => trial.phase !== 'confirmation'),
    [trials],
  );
  const screeningResult = useMemo(
    () => recommend(screeningTrials, settings.sens),
    [screeningTrials, settings.sens],
  );
  const cardRankings = screeningResult.ranked.map((screeningRow) => {
    const confirmationRow = confirmationRun
      ? result.ranked.find((row) => row.sens === screeningRow.sens)
      : undefined;
    return {
      sens: screeningRow.sens,
      screeningScore: screeningRow.score,
      confirmationScore: confirmationRow?.score ?? null,
      exerciseScores: modes.map(
        (exercise) => summarizeExercise(screeningTrials, exercise.id, screeningRow.sens).score,
      ),
    };
  });
  const exerciseCardData = modes.map((exercise) => ({
    ...exercise,
    screening: summarizeExercise(screeningTrials, exercise.id, result.sens),
    confirmation: confirmationRun
      ? summarizeExercise(analysisTrials, exercise.id, result.sens)
      : null,
  }));
  const aimProfileScores = Object.fromEntries(
    exerciseCardData.map((exercise) => [
      exercise.id,
      (confirmationRun ? exercise.confirmation?.score : null) ?? exercise.screening.score,
    ]),
  );
  const aimProfile = getAimProfile(aimProfileScores);
  useEffect(() => {
    if (
      view !== 'results' ||
      !completedAt ||
      savedHistorySession.current === completedAt.getTime() ||
      !result.winner
    )
      return;
    savedHistorySession.current = completedAt.getTime();
    const entry: SensitivityHistoryEntry = {
      id: `${completedAt.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
      completedAt: completedAt.toISOString(),
      startingSens: settings.sens,
      recommendedSens: result.sens,
      dpi: settings.dpi,
      confidence: result.confidence,
      accuracy: centerAccuracy,
      testLength: confirmationRun ? 'Follow-up' : testLength,
      blocks: blockTotal,
      scoreGap: result.scoreGap,
      overallScore: result.winner.score,
      exerciseScores: Object.fromEntries(
        exerciseCardData.map((exercise) => [
          exercise.id,
          (confirmationRun ? exercise.confirmation?.score : null) ?? exercise.screening.score,
        ]),
      ),
      aimProfile: aimProfile.title,
      profileSummary: aimProfile.summary,
    };
    addHistoryEntry(entry);
  }, [
    view,
    completedAt,
    result,
    settings.sens,
    settings.dpi,
    centerAccuracy,
    confirmationRun,
    testLength,
    blockTotal,
    exerciseCardData,
    aimProfile,
    addHistoryEntry,
  ]);
  const cardAccuracy = useMemo(() => {
    const trialScores = trials.flatMap((trial) => {
      const scores = (trial.observations ?? []).flatMap((observation) =>
        typeof observation.centerAccuracy === 'number' ? [observation.centerAccuracy] : [],
      );
      const trialScoreMean = mean(scores);
      return trialScoreMean === null ? [] : [trialScoreMean];
    });
    return mean(trialScores);
  }, [trials]);
  const cardObservationCount = trials.reduce(
    (sum, trial) => sum + (trial.observations?.length ?? trial.shots),
    0,
  );
  const cardTestLabel = confirmationRun
    ? 'SCREENING + TOP-TWO CONFIRMATION'
    : `${testLength === 'quick' ? 'QUICK' : testLength === 'long' ? 'LONGER' : 'MOST ACCURATE'} TEST`;
  const cardDate = completedAt?.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  const observedTargets = analysisTrials.reduce(
    (total, trial) => total + (trial.observations?.length ?? trial.shots),
    0,
  );
  const copy = async () => {
    await navigator.clipboard?.writeText(`sensitivity ${result.sens}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  const createResultCardPng = async () => {
    if (!resultCardRef.current) throw new Error('The result card is not ready yet.');
    const source = new XMLSerializer().serializeToString(resultCardRef.current);
    const svgBlob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
    const svgUrl = URL.createObjectURL(svgBlob);
    try {
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('The result card image could not be rendered.'));
        image.src = svgUrl;
      });
      const canvas = document.createElement('canvas');
      canvas.width = 2400;
      canvas.height = 3280;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('This browser cannot render the result card.');
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error('PNG export failed.'))),
          'image/png',
        );
      });
    } finally {
      URL.revokeObjectURL(svgUrl);
    }
  };
  const downloadResultCard = async () => {
    try {
      const png = await createResultCardPng();
      const pngUrl = URL.createObjectURL(png);
      const link = document.createElement('a');
      link.href = pngUrl;
      link.download = `senslab-result-${fmt(result.sens, 2)}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(pngUrl), 1000);
      setCardActionMessage('Result card downloaded as a PNG.');
    } catch (error) {
      setCardActionMessage(error instanceof Error ? error.message : 'Could not export the card.');
    }
  };
  const copyResultCard = async () => {
    if (!navigator.clipboard?.write || !('ClipboardItem' in window)) {
      setCardActionMessage('Image copy is unavailable in this browser. Download the PNG instead.');
      return;
    }
    try {
      const png = await createResultCardPng();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      setCardActionMessage('Result card copied as an image.');
    } catch (error) {
      setCardActionMessage(error instanceof Error ? error.message : 'Could not copy the card.');
    }
  };
  const fmt = (n: number, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : '—');
  const calculatorDpiValue = Number(calculatorDpi);
  const calculatorSensValue = Number(calculatorSens);
  const calculatorValid =
    Number.isFinite(calculatorDpiValue) &&
    calculatorDpiValue >= 100 &&
    calculatorDpiValue <= 6400 &&
    Number.isFinite(calculatorSensValue) &&
    calculatorSensValue >= 0.01 &&
    calculatorSensValue <= 20;
  return (
    <main data-theme={theme} style={{ '--accent': themeColors[theme] } as CSSProperties}>
      <header className="nav">
        <button className="wordmark" onClick={() => setView('home')}>
          SENS<span>/</span>LAB
        </button>
        <nav>
          <button onClick={() => setView('home')}>HOME</button>
          <button
            onClick={() => document.getElementById('how')?.scrollIntoView({ behavior: 'smooth' })}
          >
            HOW IT WORKS
          </button>
          <button onClick={() => setView('setup')}>CALIBRATION</button>
        </nav>
        <label className="theme-switcher">
          <span>THEME</span>
          <select value={theme} onChange={(event) => changeTheme(event.target.value)}>
            <option value="lime">LIME</option>
            <option value="blue">ARCTIC</option>
            <option value="coral">CORAL</option>
            <option value="violet">VIOLET</option>
          </select>
        </label>
        <button className="button button-small" onClick={() => setView('setup')}>
          START TEST <ArrowUpRight size={14} />
        </button>
      </header>
      <AnimatePresence mode="wait">
        {view === 'home' && (
          <motion.div
            key="home"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <section className="hero">
              <div className="hero-copy">
                <div className="eyebrow">
                  <i /> AIM CALIBRATION SYSTEM <span>V 1.0</span>
                </div>
                <h1>
                  FIND
                  <br />
                  YOUR <em>SENS.</em>
                </h1>
                <p className="hero-sub">
                  Stop guessing. Measure your aim.
                  <br />
                  Discover the sensitivity that works for you.
                </p>
                <div className="hero-actions">
                  <button className="button" onClick={() => setView('setup')}>
                    START CALIBRATION <ArrowUpRight size={16} />
                  </button>
                  <button
                    className="text-button"
                    onClick={() =>
                      document.getElementById('how')?.scrollIntoView({ behavior: 'smooth' })
                    }
                  >
                    HOW IT WORKS <ArrowDown size={14} />
                  </button>
                </div>
                <div className="hero-meta">
                  <span>01 — MEASURE</span>
                  <span>02 — ANALYZE</span>
                  <span>03 — OPTIMIZE</span>
                </div>
              </div>
              <div className="hero-art">
                <Canvas camera={{ position: [0, 0, 7], fov: 42 }}>
                  <ambientLight intensity={1} />
                  <Float speed={1.4} rotationIntensity={0.08} floatIntensity={0.12}>
                    <group>
                      <mesh>
                        <torusGeometry args={[1.55, 0.004, 8, 120]} />
                        <meshBasicMaterial color="#525252" />
                      </mesh>
                      <mesh rotation={[0, 0, Math.PI / 2]}>
                        <torusGeometry args={[1.12, 0.003, 8, 120]} />
                        <meshBasicMaterial color="#383838" />
                      </mesh>
                      <mesh>
                        <circleGeometry args={[0.045, 24]} />
                        <meshBasicMaterial color="white" />
                      </mesh>
                      <Line
                        points={[
                          [-2.3, 0, 0],
                          [2.3, 0, 0],
                        ]}
                        color="#505050"
                        lineWidth={0.6}
                      />
                      <Line
                        points={[
                          [0, -2.3, 0],
                          [0, 2.3, 0],
                        ]}
                        color="#505050"
                        lineWidth={0.6}
                      />
                      <CursorMarker />
                    </group>
                  </Float>
                </Canvas>
                <div className="art-label top">INPUT / OUTPUT</div>
                <div className="art-label bottom">FIG 001 — ACQUISITION FIELD</div>
              </div>
              <div className="hero-index">
                [ 45° 00′ 00″ ]<span>PRECISION IN / PERFORMANCE OUT</span>
              </div>
            </section>
            <section className="calculator section" aria-labelledby="calculator-title">
              <div className="section-heading">
                <span>QUICK CALCULATOR</span>
                <span>NO TEST REQUIRED</span>
              </div>
              <div className="calculator-layout">
                <div className="calculator-copy">
                  <h2 id="calculator-title">
                    KNOW YOUR
                    <br />
                    <em>NUMBERS.</em>
                  </h2>
                  <p>
                    Enter your current mouse settings to see your effective DPI and estimated
                    mouse travel for a full 360° turn in CS2.
                  </p>
                  <div className="calculator-inputs">
                    <label>
                      MOUSE DPI
                      <input
                        type="number"
                        min="100"
                        max="6400"
                        step="1"
                        value={calculatorDpi}
                        onChange={(event) => setCalculatorDpi(event.target.value)}
                        aria-label="Mouse DPI for sensitivity calculator"
                      />
                    </label>
                    <label>
                      CS2 SENSITIVITY
                      <input
                        type="number"
                        min="0.01"
                        max="20"
                        step="0.01"
                        value={calculatorSens}
                        onChange={(event) => setCalculatorSens(event.target.value)}
                        aria-label="CS2 sensitivity for sensitivity calculator"
                      />
                    </label>
                  </div>
                </div>
                <div className="calculator-output" aria-live="polite">
                  <div className="calculator-primary">
                    <span>EFFECTIVE DPI</span>
                    <strong>{calculatorValid ? fmt(edpi(calculatorDpiValue, calculatorSensValue), 0) : '—'}</strong>
                    <small>{calculatorValid ? `${calculatorDpiValue} DPI × ${fmt(calculatorSensValue, 2)} SENS` : 'ENTER DPI 100–6400 AND SENS 0.01–20'}</small>
                  </div>
                  <div className="calculator-secondary">
                    <span>ESTIMATED CM / 360°</span>
                    <strong>{calculatorValid ? `${fmt(cm360(calculatorDpiValue, calculatorSensValue), 1)} cm` : '—'}</strong>
                  </div>
                  <button
                    className="button button-secondary"
                    disabled={!calculatorValid}
                    onClick={() => {
                      setSettings({ ...settings, dpi: calculatorDpiValue, sens: calculatorSensValue });
                      setDpiInput(String(calculatorDpiValue));
                      setSensInput(String(calculatorSensValue));
                      setView('setup');
                    }}
                  >
                    USE THESE SETTINGS <ArrowUpRight size={14} />
                  </button>
                  <small className="calculator-note">CS2 default yaw 0.022 · Actual feel can vary with in-game settings and OS input.</small>
                </div>
              </div>
            </section>
            <section id="how" className="how section">
              <div className="section-heading">
                <span>THE PROCESS</span>
                <span>01 / 03</span>
              </div>
              <h2>
                DATA OVER
                <br />
                <em>GUESSWORK.</em>
              </h2>
              <p className="how-intro">
                Start with your current CS2 sensitivity and DPI. SENS/LAB compares five nearby
                settings—from 80% to 120% of your current sensitivity—while keeping your DPI fixed.
                At each setting, you complete four aim exercises and a 20-second tracking run. We
                score hit rate, speed, aim error, corrections, and how close you keep the crosshair
                to the moving target; each exercise contributes equally to the comparison.
                <br />
                <br />
                The highest-scoring setting is a data-backed starting point for your own practice,
                not a promise of perfect aim. We also show eDPI (DPI × sensitivity) and estimated
                cm/360° so you can understand how each setting changes your mouse movement. Your DPI
                stays the same throughout.
              </p>
              <div className="steps">
                {[
                  [
                    '01',
                    'TEST',
                    'Complete four aim exercises and a 20-second no-click tracking run for each sensitivity.',
                  ],
                  [
                    '02',
                    'ANALYZE',
                    'We compare accuracy, speed, corrections and tracking control.',
                  ],
                  ['03', 'OPTIMIZE', 'Get a sensitivity range backed by your recorded trials.'],
                ].map(([n, t, d]) => (
                  <article key={n}>
                    <span>{n}</span>
                    <h3>{t}</h3>
                    <p>{d}</p>
                  </article>
                ))}
              </div>
              <div className="metrics">
                <span>WHAT WE MEASURE</span>
                <p>
                  Acquisition time <i /> Angular error <i /> Corrections <i /> Directional balance{' '}
                  <i /> Tracking consistency
                </p>
              </div>
            </section>
            <footer>
              <span className="wordmark">
                SENS<span>/</span>LAB
              </span>
              <span>FIND YOUR SENS.</span>
              <span>© 2026 — BROWSER ESTIMATE</span>
            </footer>
          </motion.div>
        )}
        {view === 'setup' && (
          <motion.section
            className="setup page-shell"
            key="setup"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            <button className="back" onClick={() => setView('home')}>
              <ArrowLeft size={15} /> BACK
            </button>
            <div className="eyebrow">
              <i /> CALIBRATION / CONFIGURATION
            </div>
            <h1 className="page-title">
              SET YOUR
              <br />
              <em>BASELINE.</em>
            </h1>
            <p className="muted setup-intro">
              We’ll compare five nearby sensitivities. Your DPI stays yours; the test finds an
              in-game setting that performs well for you.
            </p>
            <section className="length-choice">
              <div className="section-heading">
                <span>TEST LENGTH</span>
                <span>CHOOSE YOUR DEPTH</span>
              </div>
              <div className="length-options">
                <button
                  type="button"
                  className={testLength === 'quick' ? 'length-card selected' : 'length-card'}
                  aria-pressed={testLength === 'quick'}
                  onClick={() => setTestLength('quick')}
                >
                  <span>01 / QUICK TEST</span>
                  <strong>One comparison block</strong>
                  <p>
                    100 target attempts plus five 20-second tracking runs · about 4–6 minutes. A
                    fast screening pass across all five settings. Confidence stays limited because
                    each setting is tested once per exercise.
                  </p>
                </button>
                <button
                  type="button"
                  className={testLength === 'long' ? 'length-card selected' : 'length-card'}
                  aria-pressed={testLength === 'long'}
                  onClick={() => setTestLength('long')}
                >
                  <span>02 / LONGER TEST</span>
                  <strong>Three randomized blocks</strong>
                  <p>
                    240 target attempts plus 15 tracking runs (five minutes total) · about 10–15
                    minutes. Each setting returns in every block, with candidate order shuffled
                    between blocks to check consistency and support stronger confidence.
                  </p>
                </button>
                <button
                  type="button"
                  className={testLength === 'longest' ? 'length-card selected' : 'length-card'}
                  aria-pressed={testLength === 'longest'}
                  onClick={() => setTestLength('longest')}
                >
                  <span>03 / MOST ACCURATE</span>
                  <strong>Five randomized blocks</strong>
                  <p>
                    400 target attempts plus 25 tracking runs (eight minutes 20 seconds total) ·
                    about 18–25 minutes. Five matched comparisons provide the strongest consistency
                    check and the narrowest confidence estimate.
                  </p>
                </button>
              </div>
            </section>
            <div className="settings-grid">
              <label>
                MOUSE DPI
                <input
                  type="text"
                  inputMode="numeric"
                  min="100"
                  max="6400"
                  value={dpiInput}
                  onChange={(e) => setDpiInput(e.target.value)}
                  onBlur={() => commitSetting('dpi', dpiInput, setDpiInput, 100, 6400)}
                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                />
                <small>Check your mouse manufacturer software. Browsers cannot detect DPI.</small>
              </label>
              <label>
                CS2 SENSITIVITY
                <input
                  type="text"
                  inputMode="decimal"
                  min="0.01"
                  max="20"
                  value={sensInput}
                  onChange={(e) => setSensInput(e.target.value)}
                  onBlur={(e) =>
                    commitSetting('sens', e.currentTarget.value, setSensInput, 0.01, 20)
                  }
                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                />
                <small>Your current in-game sensitivity is the baseline.</small>
              </label>
              <label>
                POLLING RATE <span className="optional">OPTIONAL</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={pollingInput}
                  onChange={(e) => setPollingInput(e.target.value)}
                  onBlur={() => commitSetting('polling', pollingInput, setPollingInput, 125, 8000)}
                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                  aria-label="Mouse polling rate in hertz"
                />
              </label>
              <label>
                REFRESH RATE <span className="optional">OPTIONAL</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={refreshInput}
                  onChange={(e) => setRefreshInput(e.target.value)}
                  onBlur={() => commitSetting('refresh', refreshInput, setRefreshInput, 30, 1000)}
                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                  aria-label="Display refresh rate in hertz"
                />
              </label>
            </div>
            <label className="sound-setting">
              <span>
                <strong>HIT SOUND</strong>
                <small>Play a short tone when you hit a target.</small>
              </span>
              <input
                type="checkbox"
                role="switch"
                checked={soundEnabled}
                onChange={toggleSound}
                aria-label="Play a sound when a target is hit"
              />
            </label>
            <div className="calc-strip">
              <div>
                <span>eDPI</span>
                <strong>{fmt(edpi(settings.dpi, settings.sens), 0)}</strong>
              </div>
              <div>
                <span>EST. CM / 360°</span>
                <strong>
                  {fmt(cm360(settings.dpi, settings.sens), 1)} <small>cm</small>
                </strong>
              </div>
              <p>
                Based on default CS2 yaw (0.022) and standard input settings. Browser measurement is
                an estimate; OS acceleration and browser behavior can affect results.
              </p>
            </div>
            <div className="setup-foot">
              <span>
                {modes.length - 1} AIM EXERCISES ·{' '}
                {repetitions * (modes.length - 1) * candidates(settings.sens).length * blockTotal}{' '}
                TARGETS · {candidates(settings.sens).length * blockTotal} × 20 SEC TRACKING ·{' '}
                {testLength === 'longest'
                  ? 'ABOUT 18–25 MIN'
                  : testLength === 'long'
                    ? 'ABOUT 10–15 MIN'
                    : 'ABOUT 4–6 MIN'}
              </span>
              <button
                className="button"
                disabled={
                  !settings.dpi ||
                  !settings.sens ||
                  settings.dpi < 100 ||
                  settings.dpi > 6400 ||
                  settings.sens < 0.01 ||
                  settings.sens > 20
                }
                onClick={start}
              >
                BEGIN TEST <ArrowUpRight size={16} />
              </button>
            </div>
          </motion.section>
        )}
        {view === 'trainer' && (
          <motion.section
            className="trainer"
            key="trainer"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <div className="trainer-top">
              <button
                className="wordmark"
                onClick={() => {
                  document.exitPointerLock?.();
                  setView('home');
                }}
              >
                SENS<span>/</span>LAB
              </button>
              <div>
                <span className="eyebrow">
                  {confirmationRun ? 'CONFIRMATION' : 'SENSITIVITY'} {fmt(sens, 2)}
                </span>
                <span className="muted">{mode.name}</span>
              </div>
              <button
                className="icon-button"
                onClick={() => {
                  setPaused(true);
                  document.exitPointerLock?.();
                }}
              >
                <Pause size={17} /> PAUSE
              </button>
            </div>
            {unsupported ? (
              <div className="arena unsupported">
                <div className="pause-screen">
                  <span className="eyebrow">DESKTOP INPUT REQUIRED</span>
                  <h2>
                    CONNECT A<br />
                    <em>MOUSE.</em>
                  </h2>
                  <p>
                    Aim calibration requires a desktop or laptop with a physical mouse and a browser
                    that supports pointer lock.
                  </p>
                  <button className="button" onClick={() => setView('setup')}>
                    BACK TO SETTINGS <ArrowLeft size={15} />
                  </button>
                </div>
              </div>
            ) : (
              <div className="arena">
                <Canvas
                  className="arena-canvas"
                  camera={{ position: [0, 0, 0], fov: 75 }}
                  frameloop={
                    mode.id === 'tracking' || mode.id === 'tracking-duration' ? 'always' : 'demand'
                  }
                  dpr={[1, 1.1]}
                  gl={{ antialias: false, powerPreference: 'high-performance' }}
                >
                  <Scene
                    target={target}
                    onHit={record}
                    onMiss={() => finishTargetRef.current(false)}
                    paused={paused}
                    tracking={mode.id === 'tracking' || mode.id === 'tracking-duration'}
                    trackingOnly={mode.id === 'tracking-duration'}
                    onTrackingSample={recordTrackingSample}
                    onPointerCaptured={onPointerCaptured}
                    onPointerLockChange={onPointerLockChange}
                    sensitivity={sens}
                    dpi={settings.dpi}
                    rawCounts={rawCounts}
                    onRawInputChange={setRawCounts}
                    angleRef={angleRef}
                  />
                </Canvas>
                <div className="crosshair">
                  <i />
                  <b />
                  <i />
                </div>
                <div className="arena-hud">
                  <div>
                    <span>
                      EXERCISE {String(modeIndex + 1).padStart(2, '0')} /{' '}
                      {String(modes.length).padStart(2, '0')}
                    </span>
                    <strong>{mode.name}</strong>
                  </div>
                  <div className="hud-right">
                    <span>
                      BLOCK {blockIndex + 1} / {blockTotal} · SENS {candidateIndex + 1} /{' '}
                      {testSens.length}
                    </span>
                    <strong>
                      {mode.id === 'tracking-duration' ? (
                        <>
                          00:{String(trackingRemaining).padStart(2, '0')} <small>REMAINING</small>
                        </>
                      ) : (
                        <>
                          {count} <small>/ {mode.count}</small>
                        </>
                      )}
                    </strong>
                  </div>
                </div>
                <div className="arena-help">
                  <MousePointer2 size={14} /> CLICK ARENA TO CAPTURE MOUSE ·{' '}
                  {mode.id === 'tracking-duration'
                    ? 'TRACK THE BALL, DO NOT CLICK'
                    : 'CLICK TARGETS'}
                  <span>{rawCounts ? 'RAW INPUT' : 'ESTIMATED INPUT'} · ESC TO PAUSE</span>
                </div>
                {waitingForCapture && (
                  <div className="capture-prompt">
                    <span className="eyebrow">READY WHEN YOU ARE</span>
                    <p>Click the arena to capture your mouse. The test starts after capture.</p>
                  </div>
                )}
                {paused && (
                  <div className="pause-screen">
                    <span className="eyebrow">SESSION PAUSED</span>
                    <h2>
                      TAKE A<br />
                      <em>BREATH.</em>
                    </h2>
                    <p>Your progress is saved in this session.</p>
                    <button
                      className="button"
                      onClick={() => {
                        setPaused(false);
                        setTrialStart(performance.now());
                      }}
                    >
                      RESUME <Play size={15} />
                    </button>
                    <button
                      className="text-button"
                      onClick={() => {
                        window.clearTimeout(missTimer.current);
                        document.exitPointerLock?.();
                        setView('setup');
                      }}
                    >
                      END SESSION
                    </button>
                  </div>
                )}
              </div>
            )}
            <div className="progress-bars">
              {Array.from({ length: testSens.length * blockTotal }, (_, i) => (
                <span
                  key={i}
                  className={
                    i < blockIndex * testSens.length + candidateIndex
                      ? 'done'
                      : i === blockIndex * testSens.length + candidateIndex
                        ? 'active'
                        : ''
                  }
                />
              ))}
            </div>
          </motion.section>
        )}
        {view === 'results' && (
          <motion.section
            className="results page-shell"
            key="results"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div className="eyebrow">
              <i /> ANALYSIS COMPLETE
            </div>
            <h1 className="page-title">
              CALIBRATION
              <br />
              <em>COMPLETE.</em>
            </h1>
            <div className="result-main">
              <div>
                <span>RECOMMENDED CS2 SENSITIVITY</span>
                <strong>{fmt(result.sens, 2)}</strong>
                <small>
                  {settings.dpi} DPI <i /> {fmt(edpi(settings.dpi, result.sens), 0)} eDPI <i />{' '}
                  {fmt(cm360(settings.dpi, result.sens), 1)} cm / 360°
                </small>
              </div>
              <div className="confidence">
                <span>CONFIDENCE</span>
                <strong>{result.confidence.toUpperCase()}</strong>
                <p>
                  {observedTargets} target observations
                  <br />
                  {blockTotal} comparison block{blockTotal === 1 ? '' : 's'} ·{' '}
                  {result.ranked.length} sensitivities
                  <br />
                  Score gap: {(result.scoreGap * 100).toFixed(1)} pts
                  <br />
                  95% score-gap margin:{' '}
                  {Number.isFinite(result.confidenceInterval95)
                    ? `${(result.confidenceInterval95 * 100).toFixed(1)} pts`
                    : 'not yet estimable'}
                </p>
                <p className="confidence-reason">{result.confidenceReason}</p>
              </div>
            </div>
            <p className="result-copy">
              {confirmationRun
                ? result.confidence === 'High'
                  ? 'The six-block follow-up supports the leading setting in a fresh comparison of the two strongest candidates from your first test.'
                  : 'The follow-up still found no clear winner between the two leading settings. Their scores are close or varied across blocks; try either in-game and keep the one that feels more controllable.'
                : result.confidence === 'Insufficient data'
                  ? 'Not enough recorded trial data to make a recommendation.'
                  : result.confidence === 'Low'
                    ? testLength === 'quick'
                      ? 'This quick pass is a screening result. Run the longer test to check whether the leading sensitivity stays ahead across randomized blocks.'
                      : 'The block results were close or varied. Treat the leading setting as a range to explore, not a certain winner.'
                    : `Your recorded exercises favored ${fmt(result.sens, 2)} sensitivity. Keep your DPI at ${settings.dpi}; the recommendation changes in-game sensitivity only.`}
            </p>
            <div className="result-grid">
              <article className="accuracy-card">
                <span>CENTER ACCURACY</span>
                <strong>
                  {centerAccuracy === null ? '—' : `${Math.round(centerAccuracy)}/100`}
                </strong>
                <div className="accuracy-track">
                  <i style={{ width: `${centerAccuracy ?? 0}%` }} />
                </div>
                <p>
                  Average precision across attempts. Shots closer to each ball’s center score
                  higher; misses score zero.
                </p>
              </article>
              <article>
                <span>CURRENT VS RECOMMENDED</span>
                <div className="compare">
                  <div>
                    <small>CURRENT</small>
                    <b>{fmt(settings.sens, 2)}</b>
                    <span>{fmt(edpi(settings.dpi, settings.sens), 0)} eDPI</span>
                  </div>
                  <ArrowRight size={17} />
                  <div>
                    <small>RECOMMENDED</small>
                    <b>{fmt(result.sens, 2)}</b>
                    <span>{fmt(edpi(settings.dpi, result.sens), 0)} eDPI</span>
                  </div>
                </div>
              </article>
              <article>
                <span>TRIAL SCORES</span>
                {result.ranked.map((r) => (
                  <div className="score-row" key={r.sens}>
                    <b>{fmt(r.sens, 2)}</b>
                    <div>
                      <i style={{ width: `${Math.max(8, r.score * 100)}%` }} />
                    </div>
                    <small>
                      {Math.round(r.score * 100)}% ±{(1.96 * r.standardError * 100).toFixed(1)}
                    </small>
                  </div>
                ))}
              </article>
            </div>
            <section className="performance-section" aria-labelledby="performance-title">
              <div className="performance-heading">
                <div>
                  <span className="eyebrow">YOUR SESSION</span>
                  <h2 id="performance-title">PERFORMANCE BREAKDOWN</h2>
                  <p>Scores for the recommended sensitivity, split by exercise.</p>
                </div>
              </div>
              <div className="performance-list">
                {exerciseCardData.map((exercise) => {
                  const metrics = confirmationRun && exercise.confirmation
                    ? exercise.confirmation
                    : exercise.screening;
                  return (
                    <article className="performance-row" key={exercise.id}>
                      <div className="performance-label">
                        <strong>{exercise.name}</strong>
                        <span>{exercise.desc}</span>
                      </div>
                      <div className="performance-score">
                        <div className="performance-track">
                          <i style={{ width: `${Math.max(0, Math.min(100, metrics.score * 100))}%` }} />
                        </div>
                        <b>{Math.round(metrics.score * 100)}<small>/100</small></b>
                      </div>
                      <div className="performance-stat">
                        <span>CENTER</span>
                        <b>{metrics.centerAccuracy === null ? '—' : `${Math.round(metrics.centerAccuracy)}/100`}</b>
                      </div>
                      <div className="performance-stat">
                        <span>HIT RATE</span>
                        <b>{metrics.hitRate === null ? 'TRACKING' : `${Math.round(metrics.hitRate)}%`}</b>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
            <section className="aim-profile" aria-labelledby="aim-profile-title">
              <div className="aim-profile-intro">
                <span className="eyebrow">YOUR AIM PROFILE</span>
                <h2 id="aim-profile-title">{aimProfile.title}</h2>
                <p>{aimProfile.summary}</p>
              </div>
              <div className="aim-profile-skills">
                {aimProfile.groups.map((group) => (
                  <div className="aim-skill" key={group.id}>
                    <div>
                      <span>{group.name}</span>
                      <b>{Math.round(group.score * 100)}/100</b>
                    </div>
                    <div className="performance-track">
                      <i style={{ width: `${Math.max(0, Math.min(100, group.score * 100))}%` }} />
                    </div>
                  </div>
                ))}
              </div>
              <small>Based on this session’s task scores; it describes test performance, not a permanent player label.</small>
            </section>
            <section className="personal-bests" aria-labelledby="personal-bests-title">
              <div className="performance-heading">
                <div>
                  <span className="eyebrow">ACROSS ALL SAVED SESSIONS</span>
                  <h2 id="personal-bests-title">PERSONAL BESTS</h2>
                </div>
                {(personalBests.accuracy !== null || personalBests.overallScore !== null) && (
                  <button className="text-button" onClick={clearPersonalBests}>
                    RESET BESTS
                  </button>
                )}
              </div>
              <div className="best-grid">
                <article className="best-card">
                  <span>BEST CENTER ACCURACY</span>
                  <strong>{personalBests.accuracy === null ? '—' : `${Math.round(personalBests.accuracy)}/100`}</strong>
                </article>
                <article className="best-card">
                  <span>BEST SESSION SCORE</span>
                  <strong>{personalBests.overallScore === null ? '—' : `${Math.round(personalBests.overallScore * 100)}/100`}</strong>
                </article>
                <article className="best-card">
                  <span>STRONGEST CONFIDENCE</span>
                  <strong>{personalBests.confidence ?? '—'}</strong>
                </article>
                {modes.map((exercise) => (
                  <article className="best-card" key={exercise.id}>
                    <span>BEST · {exercise.name}</span>
                    <strong>
                      {personalBests.exerciseScores[exercise.id] === undefined
                        ? '—'
                        : `${Math.round(personalBests.exerciseScores[exercise.id] * 100)}/100`}
                    </strong>
                  </article>
                ))}
              </div>
              <small className="history-note">Personal bests stay on this device, even if you clear your session history.</small>
            </section>
            <section className="history-section" aria-labelledby="history-title">
              <div className="history-heading">
                <div>
                  <span className="eyebrow">SAVED IN THIS BROWSER</span>
                  <h2 id="history-title">SENSITIVITY HISTORY</h2>
                  <p>Compare recommendations from your past calibration sessions.</p>
                </div>
                {history.length > 0 && (
                  <button className="text-button" onClick={clearHistory}>
                    CLEAR HISTORY
                  </button>
                )}
              </div>
              {history.length === 0 ? (
                <p className="history-empty">Your completed sessions will appear here.</p>
              ) : (
                <div className="history-list">
                  {history.map((entry) => (
                    <article className="history-row" key={entry.id}>
                      <div className="history-date">
                        <strong>
                          {new Date(entry.completedAt).toLocaleDateString(undefined, {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                          })}
                        </strong>
                        <span>{entry.testLength} · {entry.blocks} BLOCKS · {entry.aimProfile}</span>
                      </div>
                      <div className="history-sens">
                        <span>STARTING</span>
                        <b>{fmt(entry.startingSens, 2)}</b>
                      </div>
                      <ArrowRight size={15} aria-hidden="true" />
                      <div className="history-sens recommended">
                        <span>RECOMMENDED</span>
                        <b>{fmt(entry.recommendedSens, 2)}</b>
                      </div>
                      <div className="history-meta">
                        <span>{entry.dpi} DPI</span>
                        <span>{entry.confidence.toUpperCase()} CONFIDENCE</span>
                        <span>{entry.accuracy === null ? '—' : `${Math.round(entry.accuracy)}/100`} ACCURACY</span>
                      </div>
                      <button
                        className="history-remove"
                        aria-label={`Remove history entry from ${new Date(entry.completedAt).toLocaleDateString()}`}
                        onClick={() => removeHistoryEntry(entry.id)}
                      >
                        REMOVE
                      </button>
                    </article>
                  ))}
                </div>
              )}
              <small className="history-note">History is stored locally on this device and browser.</small>
            </section>
            <section className="share-card-section">
              <div className="share-card-heading">
                <div>
                  <span>YOUR SESSION, IN ONE IMAGE</span>
                  <p>All tested settings, exercise scores, and your final result.</p>
                </div>
                <span>PNG · 2400 × 3280</span>
              </div>
              <div className="share-card-preview">
                <svg
                  ref={resultCardRef}
                  xmlns="http://www.w3.org/2000/svg"
                  width="1200"
                  height="1640"
                  viewBox="0 0 1200 1640"
                  role="img"
                  aria-label="SENS/LAB mouse sensitivity calibration result card"
                >
                  <title>SENS/LAB calibration result card</title>
                  <desc>
                    Recommended Counter-Strike 2 sensitivity, mouse settings, confidence, center
                    accuracy, exercise scores, and sensitivity comparisons.
                  </desc>
                  <defs>
                    <linearGradient id="card-glow" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0" stopColor="#172018" />
                      <stop offset="1" stopColor="#0a0a0a" />
                    </linearGradient>
                    <linearGradient id="card-bar" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0" stopColor={themeColors[theme]} />
                      <stop offset="1" stopColor="#f4f4f4" />
                    </linearGradient>
                  </defs>
                  <rect width="1200" height="1640" fill="#080909" />
                  <rect
                    x="22"
                    y="22"
                    width="1156"
                    height="1596"
                    rx="22"
                    fill="none"
                    stroke="#333638"
                    strokeWidth="2"
                  />
                  <circle cx="1030" cy="200" r="176" fill="url(#card-glow)" />
                  <path d="M72 145H1128" stroke="#343638" />
                  <text
                    x="72"
                    y="101"
                    fill="#f3f3f3"
                    fontFamily="Arial, sans-serif"
                    fontSize="37"
                    fontWeight="700"
                    letterSpacing="4"
                  >
                    SENS<tspan fill={themeColors[theme]}>/</tspan>LAB
                  </text>
                  <text
                    x="1128"
                    y="79"
                    textAnchor="end"
                    fill="#96999a"
                    fontFamily="monospace"
                    fontSize="15"
                    letterSpacing="2"
                  >
                    MOUSE SENSITIVITY REPORT
                  </text>
                  <text
                    x="1128"
                    y="108"
                    textAnchor="end"
                    fill={themeColors[theme]}
                    fontFamily="monospace"
                    fontSize="14"
                    letterSpacing="1"
                  >
                    {cardTestLabel} · {cardDate ?? 'BROWSER CALIBRATION'}
                  </text>

                  <text
                    x="74"
                    y="219"
                    fill="#929596"
                    fontFamily="monospace"
                    fontSize="15"
                    letterSpacing="3"
                  >
                    RECOMMENDED CS2 SENSITIVITY
                  </text>
                  <text
                    x="60"
                    y="366"
                    fill="#f4f4f4"
                    fontFamily="monospace"
                    fontSize="142"
                    fontWeight="500"
                    letterSpacing="-12"
                  >
                    {fmt(result.sens, 2)}
                  </text>
                  <text
                    x="80"
                    y="410"
                    fill="#a8abab"
                    fontFamily="monospace"
                    fontSize="17"
                    letterSpacing="1"
                  >
                    {settings.dpi} DPI <tspan fill={themeColors[theme]}>·</tspan>{' '}
                    {fmt(edpi(settings.dpi, result.sens), 0)} eDPI <tspan fill={themeColors[theme]}>·</tspan>{' '}
                    {fmt(cm360(settings.dpi, result.sens), 1)} cm / 360°
                  </text>

                  {[
                    { label: 'MOUSE DPI', value: `${settings.dpi}` },
                    { label: 'EFFECTIVE DPI', value: `${fmt(edpi(settings.dpi, result.sens), 0)}` },
                    {
                      label: 'EST. CM / 360°',
                      value: `${fmt(cm360(settings.dpi, result.sens), 1)} cm`,
                    },
                  ].map((metric, index) => {
                    const x = 72 + index * 358;
                    return (
                      <g key={metric.label}>
                        <rect
                          x={x}
                          y="452"
                          width="338"
                          height="137"
                          rx="7"
                          fill="#111313"
                          stroke="#303435"
                        />
                        <text
                          x={x + 20}
                          y="489"
                          fill="#929596"
                          fontFamily="monospace"
                          fontSize="13"
                          letterSpacing="2"
                        >
                          {metric.label}
                        </text>
                        <text
                          x={x + 20}
                          y="550"
                          fill="#f1f1f1"
                          fontFamily="monospace"
                          fontSize="36"
                        >
                          {metric.value}
                        </text>
                      </g>
                    );
                  })}

                  <text x="74" y="625" fill={themeColors[theme]} fontFamily="monospace" fontSize="13">
                    AIM PROFILE · {aimProfile.title}
                  </text>
                  <text
                    x="1128"
                    y="625"
                    textAnchor="end"
                    fill="#929596"
                    fontFamily="Arial, sans-serif"
                    fontSize="13"
                  >
                    {aimProfile.summary}
                  </text>

                  <text
                    x="74"
                    y="658"
                    fill="#929596"
                    fontFamily="monospace"
                    fontSize="14"
                    letterSpacing="2"
                  >
                    CENTER ACCURACY
                  </text>
                  <text
                    x="67"
                    y="760"
                    fill="#f3f3f3"
                    fontFamily="monospace"
                    fontSize="88"
                    letterSpacing="-7"
                  >
                    {cardAccuracy === null ? '—' : `${Math.round(cardAccuracy)}`}
                    <tspan fill="#929596" fontSize="30" letterSpacing="0">
                      {' '}
                      / 100
                    </tspan>
                  </text>
                  <rect x="74" y="785" width="535" height="5" rx="2" fill="#292d2d" />
                  <rect
                    x="74"
                    y="785"
                    width={535 * ((cardAccuracy ?? 0) / 100)}
                    height="5"
                    rx="2"
                    fill="url(#card-bar)"
                  />
                  <path d="M665 644V804" stroke="#333738" />
                  <text
                    x="714"
                    y="664"
                    fill="#929596"
                    fontFamily="monospace"
                    fontSize="14"
                    letterSpacing="2"
                  >
                    CONFIDENCE
                  </text>
                  <text
                    x="714"
                    y="713"
                    fill={themeColors[theme]}
                    fontFamily="monospace"
                    fontSize="34"
                    fontWeight="700"
                    letterSpacing="1"
                  >
                    {result.confidence.toUpperCase()}
                  </text>
                  <text x="714" y="753" fill="#c4c7c7" fontFamily="monospace" fontSize="14">
                    GAP {(result.scoreGap * 100).toFixed(1)} PTS
                    <tspan fill="#626767"> · </tspan>
                    95% ±
                    {Number.isFinite(result.confidenceInterval95)
                      ? (result.confidenceInterval95 * 100).toFixed(1)
                      : '—'}{' '}
                    PTS
                  </text>
                  <text x="714" y="783" fill="#7f8585" fontFamily="monospace" fontSize="13">
                    {screeningResult.winner?.blocks ?? blockTotal} SCREEN BLOCKS
                    {confirmationRun ? ` · ${result.winner?.blocks ?? 0} CONFIRM BLOCKS` : ''}
                    {' · '}
                    {cardObservationCount} OBSERVATIONS
                  </text>

                  <path d="M72 834H1128" stroke="#343638" />
                  <text
                    x="74"
                    y="875"
                    fill="#f0f0f0"
                    fontFamily="monospace"
                    fontSize="15"
                    letterSpacing="2"
                  >
                    EXERCISE BREAKDOWN · RECOMMENDED SETTING
                  </text>
                  {exerciseCardData.map((exercise, index) => {
                    const current = exercise.confirmation ?? exercise.screening;
                    const rowY = 895 + index * 61;
                    const scorePercent = Math.round(current.score * 100);
                    const detail =
                      exercise.id === 'tracking-duration'
                        ? `20 SEC TRACK · CENTER ${current.centerAccuracy === null ? '—' : Math.round(current.centerAccuracy)}/100`
                        : `HIT ${current.hitRate === null ? '—' : `${Math.round(current.hitRate)}%`} · CENTER ${current.centerAccuracy === null ? '—' : Math.round(current.centerAccuracy)} · ${current.averageTime === null ? '—' : `${Math.round(current.averageTime)} MS`}`;
                    return (
                      <g key={exercise.id}>
                        <rect
                          x="72"
                          y={rowY}
                          width="1056"
                          height="52"
                          rx="5"
                          fill="#111313"
                          stroke="#2b2f2f"
                        />
                        <text
                          x="91"
                          y={rowY + 32}
                          fill="#747a7a"
                          fontFamily="monospace"
                          fontSize="13"
                        >
                          {String(index + 1).padStart(2, '0')}
                        </text>
                        <text
                          x="132"
                          y={rowY + 32}
                          fill="#ededed"
                          fontFamily="Arial, sans-serif"
                          fontSize="16"
                        >
                          {exercise.name}
                        </text>
                        <text
                          x="604"
                          y={rowY + 33}
                          textAnchor="end"
                          fill="#f3f3f3"
                          fontFamily="monospace"
                          fontSize="18"
                        >
                          {scorePercent}
                        </text>
                        <rect x="625" y={rowY + 23} width="145" height="5" rx="2" fill="#292d2d" />
                        <rect
                          x="625"
                          y={rowY + 23}
                          width={145 * current.score}
                          height="5"
                          rx="2"
                          fill="url(#card-bar)"
                        />
                        <text
                          x="796"
                          y={rowY + 31}
                          fill="#9ba0a0"
                          fontFamily="monospace"
                          fontSize="12"
                        >
                          {confirmationRun
                            ? `SCREEN ${Math.round(exercise.screening.score * 100)} → CONFIRM ${scorePercent}`
                            : detail}
                        </text>
                      </g>
                    );
                  })}

                  <path d="M72 1224H1128" stroke="#343638" />
                  <text
                    x="74"
                    y="1264"
                    fill="#f0f0f0"
                    fontFamily="monospace"
                    fontSize="15"
                    letterSpacing="2"
                  >
                    SENSITIVITY FIELD · SCORES OUT OF 100
                  </text>
                  <text
                    x="96"
                    y="1302"
                    fill="#747a7a"
                    fontFamily="monospace"
                    fontSize="11"
                    letterSpacing="1"
                  >
                    SETTING
                  </text>
                  <text x="300" y="1302" fill="#747a7a" fontFamily="monospace" fontSize="10">
                    SCREEN
                  </text>
                  <text x="420" y="1302" fill="#747a7a" fontFamily="monospace" fontSize="10">
                    CONFIRM
                  </text>
                  {['H-FLICK', 'MICRO', 'WIDE', 'MOVING', '20S TRACK'].map((label, index) => (
                    <text
                      key={label}
                      x={565 + index * 110}
                      y="1302"
                      textAnchor="middle"
                      fill="#747a7a"
                      fontFamily="monospace"
                      fontSize="9"
                    >
                      {label}
                    </text>
                  ))}
                  {cardRankings.map((row, index) => {
                    const rowY = 1312 + index * 47;
                    const recommended = row.sens === result.sens;
                    return (
                      <g key={row.sens}>
                        <rect
                          x="72"
                          y={rowY}
                          width="1056"
                          height="39"
                          rx="4"
                          fill={recommended ? '#171c12' : '#101212'}
                          stroke={recommended ? '#718b30' : '#252929'}
                        />
                        <text
                          x="96"
                          y={rowY + 25}
                          fill={recommended ? themeColors[theme] : '#e2e4e4'}
                          fontFamily="monospace"
                          fontSize="15"
                        >
                          {fmt(row.sens, 2)}
                          {recommended ? '  ·  RECOMMENDED' : ''}
                        </text>
                        <text
                          x="300"
                          y={rowY + 25}
                          fill="#dfe1e1"
                          fontFamily="monospace"
                          fontSize="13"
                        >
                          {Math.round(row.screeningScore * 100)}
                        </text>
                        <text
                          x="420"
                          y={rowY + 25}
                          fill={row.confirmationScore === null ? '#626767' : themeColors[theme]}
                          fontFamily="monospace"
                          fontSize="13"
                        >
                          {row.confirmationScore === null
                            ? '—'
                            : `${Math.round(row.confirmationScore * 100)}`}
                        </text>
                        {row.exerciseScores.map((exerciseScore, exerciseIndex) => (
                          <text
                            key={exerciseIndex}
                            x={565 + exerciseIndex * 110}
                            y={rowY + 25}
                            textAnchor="middle"
                            fill={recommended ? themeColors[theme] : '#b9bdbd'}
                            fontFamily="monospace"
                            fontSize="13"
                          >
                            {Math.round(exerciseScore * 100)}
                          </text>
                        ))}
                      </g>
                    );
                  })}
                  <path d="M72 1571H1128" stroke="#343638" />
                  <text
                    x="74"
                    y="1606"
                    fill="#747a7a"
                    fontFamily="monospace"
                    fontSize="12"
                    letterSpacing="1"
                  >
                    BROWSER AIM ESTIMATE · DPI HELD CONSTANT · SENS/LAB
                  </text>
                  <text
                    x="1128"
                    y="1606"
                    textAnchor="end"
                    fill={themeColors[theme]}
                    fontFamily="monospace"
                    fontSize="12"
                  >
                    {cardDate ?? ''}
                  </text>
                </svg>
              </div>
              <div className="share-card-actions">
                <button className="button" onClick={downloadResultCard}>
                  <Download size={15} /> DOWNLOAD RESULT PNG
                </button>
                <button className="button button-secondary" onClick={copyResultCard}>
                  <Copy size={15} /> COPY CARD IMAGE
                </button>
              </div>
              {cardActionMessage && <p className="card-action-message">{cardActionMessage}</p>}
            </section>
            <div className="result-actions">
              {!confirmationRun && result.ranked.length >= 2 && result.confidence !== 'High' && (
                <button className="button button-secondary" onClick={startConfirmation}>
                  <ArrowRight size={15} /> CONFIRM TOP TWO · 6 BLOCKS
                </button>
              )}
              <button className="button" onClick={copy}>
                {copied ? <Check size={15} /> : <Copy size={15} />}{' '}
                {copied ? 'COPIED' : 'COPY CS2 SETTINGS'}
              </button>
              <button
                className="button button-secondary"
                onClick={() => {
                  setView('setup');
                }}
              >
                <RotateCcw size={15} /> RETEST
              </button>
              <button className="text-button" onClick={() => setView('home')}>
                BACK TO HOME
              </button>
            </div>
            <p className="fineprint">
              Recommendation reflects browser-based tests, not exact CS2 input. Browser and
              operating system mouse handling vary. No single sensitivity is perfect for every
              player.
            </p>
          </motion.section>
        )}
      </AnimatePresence>
    </main>
  );
}
