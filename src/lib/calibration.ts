export const YAW = 0.022;
export const edpi = (dpi: number, sens: number) => dpi * sens;
export const cm360 = (dpi: number, sens: number) => (2.54 * 360) / (dpi * sens * YAW);
export function degreesPerMouseInput(sens: number, dpi: number, rawCounts: boolean): number {
  const browserCountScale = rawCounts ? 1 : dpi / 800;
  return YAW * sens * browserCountScale;
}
export type Observation = {
  hit: boolean;
  mode?: string;
  timeMs: number;
  /** Aim point proximity to the target center, from 0 to 100. */
  centerAccuracy?: number;
  angularErrorDeg: number | null;
  corrections: number;
  overshot: boolean;
  undershot: boolean;
};
export type Trial = {
  sens: number;
  hits: number;
  shots: number;
  times: number[];
  errors: number[];
  corrections: number;
  overshoots: number;
  undershoots?: number;
  mode: string;
  side?: 'left' | 'right';
  block?: number;
  phase?: 'screening' | 'confirmation';
  observations?: Observation[];
};
export function candidates(base: number): number[] {
  return [
    ...new Set(
      [base, base * 0.8, base * 1.2, base * 0.9, base * 1.1].map((n) => Number(n.toFixed(4))),
    ),
  ];
}
export function observationScore(o: Observation): number {
  if (o.mode === 'tracking-duration')
    return Math.max(0, Math.min(1, (o.centerAccuracy ?? 0) / 100));
  if (!o.hit) return 0;
  const speed = Math.max(0, Math.min(1, (1500 - o.timeMs) / 1200));
  const error = o.angularErrorDeg === null ? 1 : Math.max(0, 1 - o.angularErrorDeg / 18);
  const correction = Math.max(0, 1 - o.corrections * 0.35);
  const overshoot = o.overshot ? 0 : 1;
  return 0.35 + 0.2 * speed + 0.2 * error + 0.15 * correction + 0.1 * overshoot;
}
export function score(t: Trial): number {
  if (t.observations?.length)
    return t.observations.reduce((sum, o) => sum + observationScore(o), 0) / t.observations.length;
  const accuracy = t.shots ? t.hits / t.shots : 0;
  const speed = t.times.length
    ? Math.max(0, Math.min(1, (1500 - t.times.reduce((a, b) => a + b, 0) / t.times.length) / 1200))
    : 0;
  const error = t.errors.length
    ? Math.max(0, 1 - t.errors.reduce((a, b) => a + b, 0) / t.errors.length / 18)
    : 0;
  const correction = Math.max(0, 1 - (t.corrections / Math.max(1, t.shots)) * 0.35);
  const overshoot = Math.max(0, 1 - t.overshoots / Math.max(1, t.shots));
  return 0.35 * accuracy + 0.2 * speed + 0.2 * error + 0.15 * correction + 0.1 * overshoot;
}
export function recommend(
  trials: Trial[],
  base: number,
  options: { allowTwoCandidates?: boolean } = {},
) {
  const groups = new Map<number, Trial[]>();
  for (const t of trials) {
    const a = groups.get(t.sens) || [];
    a.push(t);
    groups.set(t.sens, a);
  }
  const ranked = [...groups]
    .map(([sens, ts]) => {
      const observations = ts.flatMap((t) => t.observations ?? []);
      const values = ts.map(score);
      const blockIds = [...new Set(ts.map((t) => t.block ?? 0))];
      const blockScores = blockIds.map((block) => {
        const blockTrials = ts.filter((t) => (t.block ?? 0) === block);
        const blockValues = blockTrials.map(score);
        return {
          block,
          score:
            blockValues.reduce((sum, value) => sum + value, 0) / Math.max(1, blockValues.length),
        };
      });
      const mean =
        blockScores.reduce((sum, value) => sum + value.score, 0) / Math.max(1, blockScores.length);
      const valuesMean = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
      const variance =
        blockScores.length > 1
          ? blockScores.reduce((sum, value) => sum + (value.score - mean) ** 2, 0) /
            (blockScores.length - 1)
          : values.length > 1
            ? values.reduce((sum, value) => sum + (value - valuesMean) ** 2, 0) /
              (values.length - 1)
            : 0;
      const effectiveN = blockScores.length > 1 ? blockScores.length : values.length;
      return {
        sens,
        score: mean,
        n: observations.length || ts.length,
        standardError: Math.sqrt(variance / Math.max(1, effectiveN)),
        modes: new Set(ts.map((t) => t.mode)).size,
        hasTimedTracking: ts.some((t) => t.mode === 'tracking-duration'),
        blocks: blockScores.length,
        blockScores,
      };
    })
    .sort((a, b) => b.score - a.score);
  const winner = ranked[0];
  if (!winner)
    return {
      sens: base,
      confidence: 'Insufficient data',
      winner: null,
      ranked,
      scoreGap: 0,
      confidenceInterval95: Infinity,
      clearWinner: false,
    };
  const runnerUp = ranked[1];
  const pairedDifferences = runnerUp
    ? winner.blockScores.flatMap((w) => {
        const r = runnerUp.blockScores.find((x) => x.block === w.block);
        return r ? [w.score - r.score] : [];
      })
    : [];
  const gap = pairedDifferences.length
    ? pairedDifferences.reduce((sum, difference) => sum + difference, 0) / pairedDifferences.length
    : winner.score - (runnerUp?.score ?? 0);
  const pairedVariance =
    pairedDifferences.length > 1
      ? pairedDifferences.reduce((sum, difference) => sum + (difference - gap) ** 2, 0) /
        (pairedDifferences.length - 1)
      : 0;
  const criticalValue =
    pairedDifferences.length === 6
      ? 2.571
      : pairedDifferences.length === 3
        ? 4.303
        : pairedDifferences.length === 4
          ? 3.182
          : pairedDifferences.length === 5
            ? 2.776
            : pairedDifferences.length === 2
              ? 12.706
              : 1.96;
  const ci95 = runnerUp
    ? pairedDifferences.length > 1
      ? criticalValue * Math.sqrt(pairedVariance / pairedDifferences.length)
      : 1.96 * Math.sqrt(winner.standardError ** 2 + runnerUp.standardError ** 2)
    : Infinity;
  const requiredModes = ranked.some((row) => row.hasTimedTracking) ? 5 : 4;
  const enough =
    winner.n >= 40 &&
    winner.modes >= requiredModes &&
    winner.blocks >= 3 &&
    ranked.length >= (options.allowTwoCandidates ? 2 : 3) &&
    ranked.every((row) => row.n >= 40 && row.modes >= requiredModes && row.blocks >= 3);
  const confidence = !enough ? 'Low' : gap > ci95 ? 'High' : gap > ci95 * 0.5 ? 'Moderate' : 'Low';
  const confidenceReason = !enough
    ? 'More complete sensitivity blocks are needed before confidence can rise.'
    : gap > ci95
      ? 'The leading sensitivity clears the 95% score-gap margin.'
      : gap > ci95 * 0.5
        ? 'The leader is ahead, but the gap does not clear the 95% margin.'
        : 'The leading settings are too close or vary too much between blocks.';
  return {
    sens: winner.sens,
    confidence,
    winner,
    ranked,
    scoreGap: gap,
    confidenceInterval95: ci95,
    confidenceReason,
    clearWinner: enough && gap > ci95,
  };
}
