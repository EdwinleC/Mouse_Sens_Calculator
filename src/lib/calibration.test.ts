import { describe, expect, it } from 'vitest';
import {
  candidates,
  cm360,
  degreesPerMouseInput,
  edpi,
  recommend,
  score,
  type Observation,
  type Trial,
} from './calibration';

const sample = (sens: number, hits: number): Trial => ({
  sens,
  hits,
  shots: 10,
  times: Array(10).fill(400),
  errors: Array(10).fill(2),
  corrections: 1,
  overshoots: 1,
  mode: 'horizontal',
});
const repeated = (sens: number, mode: string, hit: boolean, block = 0, count = 12): Trial => {
  const observations: Observation[] = Array.from({ length: count }, () => ({
    hit,
    timeMs: hit ? 350 : 2500,
    angularErrorDeg: hit ? 1 : null,
    corrections: 0,
    overshot: false,
    undershot: false,
  }));
  return {
    sens,
    mode,
    block,
    hits: hit ? count : 0,
    shots: count,
    times: hit ? Array(count).fill(350) : [],
    errors: hit ? Array(count).fill(1) : [],
    corrections: 0,
    overshoots: 0,
    observations,
  };
};
describe('CS2 calibration calculations', () => {
  it('calculates eDPI and cm per 360 using default yaw', () => {
    expect(edpi(800, 1.25)).toBe(1000);
    expect(cm360(800, 1)).toBeCloseTo(51.9545, 3);
  });
  it('uses raw mouse counts directly and DPI-scales only the browser fallback', () => {
    expect(degreesPerMouseInput(1, 800, true)).toBeCloseTo(0.022);
    expect(degreesPerMouseInput(1, 1600, true)).toBeCloseTo(0.022);
    expect(degreesPerMouseInput(1, 1600, false)).toBeCloseTo(0.044);
  });
  it('starts with baseline then counterbalances nearby candidate order', () => {
    const c = candidates(1);
    expect(c).toHaveLength(5);
    expect(c[0]).toBe(1);
    expect(new Set(c).size).toBe(5);
    expect(c).toContain(0.8);
    expect(c).toContain(1.2);
  });
  it('scores and selects the strongest recorded candidate', () => {
    const good = sample(1, 9),
      bad = sample(0.8, 4);
    expect(score(good)).toBeGreaterThan(score(bad));
    expect(recommend([good, bad], 1).sens).toBe(1);
  });
  it('does not claim confidence with too few repeated sets', () => {
    expect(recommend([sample(1, 10)], 1).confidence).toBe('Low');
  });
  it('requires repeated blocks across all four exercises before high confidence', () => {
    const data = [0, 1, 2].flatMap((block) =>
      ['horizontal', 'micro', 'wide', 'tracking'].flatMap((mode) => [
        repeated(1, mode, true, block, 4),
        repeated(0.8, mode, false, block, 4),
        repeated(1.2, mode, false, block, 4),
        repeated(0.9, mode, false, block, 4),
        repeated(1.1, mode, false, block, 4),
      ]),
    );
    const result = recommend(data, 1);
    expect(result.confidence).toBe('High');
    expect(result.clearWinner).toBe(true);
  });
  it('keeps a single quick block below high confidence even with a large score gap', () => {
    const data = ['horizontal', 'micro', 'wide', 'tracking'].flatMap((mode) => [
      repeated(1, mode, true, 0, 5),
      repeated(0.8, mode, false, 0, 5),
      repeated(1.2, mode, false, 0, 5),
      repeated(0.9, mode, false, 0, 5),
      repeated(1.1, mode, false, 0, 5),
    ]);
    expect(recommend(data, 1).confidence).not.toBe('High');
  });
  it('reports low confidence when repeated candidates are statistically tied', () => {
    const data = ['horizontal', 'micro', 'wide', 'tracking'].flatMap((mode) => [
      repeated(1, mode, true),
      repeated(0.8, mode, true),
      repeated(1.2, mode, true),
      repeated(0.9, mode, true),
      repeated(1.1, mode, true),
    ]);
    expect(recommend(data, 1).confidence).toBe('Low');
  });
  it('returns baseline when there is no trial evidence', () => {
    expect(recommend([], 1.2).sens).toBe(1.2);
  });
});
