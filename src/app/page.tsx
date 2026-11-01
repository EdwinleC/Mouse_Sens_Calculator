'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  type Observation,
  type Trial,
} from '@/lib/calibration';
import { useCalibration } from '@/lib/store';

type View = 'home' | 'setup' | 'trainer' | 'results';
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
function Target({
  position,
  size,
  color = '#fff',
}: {
  position: [number, number, number];
  size: number;
  color?: string;
}) {
  return (
    <mesh position={position}>
      <sphereGeometry args={[size, 24, 24]} />
      <meshBasicMaterial color={color} />
      <mesh position={[0, 0, -0.03]} raycast={() => {}}>
        <sphereGeometry args={[size * 1.5, 20, 20]} />
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
  const { camera } = useThree();
  const targetRef = useRef<THREE.Group>(null);
  const trackingOrigin = useRef(new THREE.Vector3());
  const trackingElapsed = useRef(0);
  const trackingSampleElapsed = useRef(0);
  const trackingRaycaster = useRef(new THREE.Raycaster());
  const pendingMovement = useRef({ x: 0, y: 0 });
  const screenCenter = useMemo(() => new THREE.Vector2(0, 0), []);
  const applyPendingMovement = useCallback(() => {
    if (paused) {
      pendingMovement.current.x = 0;
      pendingMovement.current.y = 0;
      return;
    }
    const { x, y } = pendingMovement.current;
    if (x === 0 && y === 0) return;
    pendingMovement.current.x = 0;
    pendingMovement.current.y = 0;
    const radiansPerInput = (degreesPerMouseInput(sensitivity, dpi, rawCounts) * Math.PI) / 180;
    const yawDelta = -x * radiansPerInput;
    angleRef.current += yawDelta;
    camera.rotation.y += yawDelta;
    camera.rotation.x = Math.max(-1.25, Math.min(1.25, camera.rotation.x - y * radiansPerInput));
  }, [angleRef, camera, dpi, paused, rawCounts, sensitivity]);
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
          .then(() => onRawInputChange(true))
          .catch(() => {
            onRawInputChange(false);
            c.requestPointerLock?.();
          });
      } catch {
        onRawInputChange(false);
        c.requestPointerLock?.();
      }
    };
    const onLockChange = () => {
      const locked = document.pointerLockElement === c;
      if (!locked) {
        pendingMovement.current.x = 0;
        pendingMovement.current.y = 0;
      }
      onPointerLockChange(locked);
      if (locked) onPointerCaptured();
      else onRawInputChange(false);
    };
    const onMouseDown = (e: MouseEvent) => {
      if (paused) return;
      if (document.pointerLockElement !== c) {
        requestLock();
        return;
      }
      if (trackingOnly) return;
      if (e.button !== 0) return;
      if (!targetRef.current || !target) {
        onMiss();
        return;
      }
      applyPendingMovement();
      raycaster.setFromCamera(center, camera);
      const targetHits = raycaster.intersectObject(targetRef.current, true);
      if (targetHits.length) {
        const targetCenter = targetRef.current.getWorldPosition(new THREE.Vector3());
        const centerOffset = raycaster.ray.distanceToPoint(targetCenter);
        const centerAccuracy = Math.max(0, 100 * (1 - centerOffset / target.size));
        onHit(centerAccuracy);
      } else onMiss();
    };
    const onMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== c || paused) return;
      pendingMovement.current.x += e.movementX;
      pendingMovement.current.y += e.movementY;
    };
    c.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('pointerlockchange', onLockChange);
    return () => {
      c.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('pointerlockchange', onLockChange);
    };
  }, [
    camera,
    paused,
    sensitivity,
    dpi,
    rawCounts,
    angleRef,
    onHit,
    onMiss,
    onRawInputChange,
    onPointerCaptured,
    onPointerLockChange,
    target,
    trackingOnly,
    applyPendingMovement,
  ]);
  useEffect(() => {
    if (!target || !targetRef.current) return;
    const initial = new THREE.Vector3(...target.position)
      .applyQuaternion(camera.quaternion)
      .add(camera.position);
    targetRef.current.position.copy(initial);
    trackingOrigin.current.copy(initial);
    trackingElapsed.current = 0;
    trackingSampleElapsed.current = 0;
  }, [target, camera]);
  useFrame((_, delta) => {
    applyPendingMovement();
    if (targetRef.current && !paused && tracking) {
      trackingElapsed.current += delta;
      const elapsed = trackingElapsed.current;
      targetRef.current.position.x = trackingOrigin.current.x + Math.sin(elapsed * 1.25) * 1.4;
      targetRef.current.position.y = trackingOrigin.current.y + Math.sin(elapsed * 0.8) * 0.45;
      if (trackingOnly) {
        trackingSampleElapsed.current += delta;
        if (trackingSampleElapsed.current >= 0.1) {
          trackingSampleElapsed.current %= 0.1;
          trackingRaycaster.current.setFromCamera(screenCenter, camera);
          const targetCenter = targetRef.current.getWorldPosition(new THREE.Vector3());
          const centerOffset = trackingRaycaster.current.ray.distanceToPoint(targetCenter);
          const centerAccuracy = Math.max(0, 100 * (1 - centerOffset / (target?.size ?? 1)));
          onTrackingSample(centerAccuracy);
        }
      }
    }
  });
  return (
    <>
      <color attach="background" args={['#101010']} />
      <fog attach="fog" args={['#101010', 13, 34]} />
      <ambientLight intensity={0.8} />
      <directionalLight position={[2, 4, 5]} intensity={1.2} />
      <gridHelper args={[100, 60, '#252525', '#1c1c1c']} position={[0, -3, -2]} />
      <mesh position={[0, 0, -12]}>
        <planeGeometry args={[200, 100]} />
        <meshBasicMaterial color="#111" />
      </mesh>
      {target && (
        <group ref={targetRef}>
          <Target position={[0, 0, 0]} size={target.size} />
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
  const { settings, trials, setSettings, addTrial, clearTrials } = useCalibration();
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
          setView('results');
        }
      } else window.setTimeout(() => spawnRef.current(), 200);
    }, 260);
  };
  finishTargetRef.current = finishTarget;
  const record = (centerAccuracy: number) => finishTargetRef.current(true, centerAccuracy);
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
  const observedTargets = analysisTrials.reduce(
    (total, trial) => total + (trial.observations?.length ?? trial.shots),
    0,
  );
  const copy = async () => {
    await navigator.clipboard?.writeText(`sensitivity ${result.sens}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  const fmt = (n: number, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : '—');
  return (
    <main>
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
                  type="number"
                  min="100"
                  max="6400"
                  value={settings.dpi}
                  onChange={(e) => setSettings({ ...settings, dpi: Number(e.target.value) })}
                />
                <small>Check your mouse manufacturer software. Browsers cannot detect DPI.</small>
              </label>
              <label>
                CS2 SENSITIVITY
                <input
                  type="number"
                  min="0.01"
                  max="20"
                  step="0.01"
                  value={settings.sens}
                  onChange={(e) => setSettings({ ...settings, sens: Number(e.target.value) })}
                />
                <small>Your current in-game sensitivity is the baseline.</small>
              </label>
              <label>
                POLLING RATE <span className="optional">OPTIONAL</span>
                <select
                  value={settings.polling}
                  onChange={(e) => setSettings({ ...settings, polling: Number(e.target.value) })}
                >
                  {[125, 250, 500, 1000, 2000, 4000, 8000].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
              <label>
                REFRESH RATE <span className="optional">OPTIONAL</span>
                <select
                  value={settings.refresh}
                  onChange={(e) => setSettings({ ...settings, refresh: Number(e.target.value) })}
                >
                  {[60, 75, 120, 144, 165, 240, 360].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
            </div>
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
                  dpr={[1, 1.25]}
                  gl={{ powerPreference: 'high-performance' }}
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
