import { describe, expect, it } from 'vitest';
import { project, rubberband, settleTime, solveSpring, springs, unrubberband } from '../../src/design/motion';

describe('springs', () => {
  it('a critically damped spring arrives without overshooting', () => {
    const f = solveSpring({ response: 0.4, damping: 1 }, 0, 100, 0);
    let max = 0;
    for (let t = 0; t < 2; t += 1 / 240) max = Math.max(max, f(t).x);
    expect(max).toBeLessThanOrEqual(100.0001);
    expect(f(2).x).toBeCloseTo(100, 2);
  });

  it('an underdamped spring overshoots, then settles', () => {
    const f = solveSpring({ response: 0.4, damping: 0.6 }, 0, 100, 0);
    let max = 0;
    for (let t = 0; t < 2; t += 1 / 240) max = Math.max(max, f(t).x);
    expect(max).toBeGreaterThan(100.5);
    expect(f(3).x).toBeCloseTo(100, 1);
  });

  it('starts exactly at the current value with the hand-off velocity', () => {
    for (const p of [springs.default, springs.smooth, { response: 0.3, damping: 1.4 }]) {
      const f = solveSpring(p, 40, 300, 1234);
      expect(f(0).x).toBeCloseTo(40, 6);
      expect(f(0).v).toBeCloseTo(1234, 3);
    }
  });

  it('velocity is the derivative of position', () => {
    for (const p of [springs.default, springs.smooth, { response: 0.5, damping: 1.6 }]) {
      const f = solveSpring(p, -50, 80, 300);
      const t = 0.123;
      const h = 1e-5;
      const numeric = (f(t + h).x - f(t - h).x) / (2 * h);
      expect(f(t).v).toBeCloseTo(numeric, 2);
    }
  });

  it('a quicker response settles sooner', () => {
    expect(settleTime({ response: 0.25, damping: 1 })).toBeLessThan(settleTime({ response: 0.5, damping: 1 }));
  });
});

describe('gesture helpers', () => {
  it('projects a flick forward in its direction, more for faster flicks', () => {
    expect(project(0)).toBe(0);
    expect(project(1000)).toBeGreaterThan(0);
    expect(project(-1000)).toBeLessThan(0);
    expect(project(2000)).toBeGreaterThan(project(1000));
  });

  it('rubber-band resistance grows with distance and never exceeds the dimension', () => {
    const d = 400;
    let last = 0;
    for (const o of [10, 50, 200, 1000, 100_000]) {
      const r = rubberband(o, d);
      expect(r).toBeGreaterThan(last);
      expect(r).toBeLessThan(d);
      expect(r).toBeLessThan(o);
      last = r;
    }
    expect(rubberband(-100, d)).toBeCloseTo(-rubberband(100, d), 6);
  });

  it('unrubberband undoes rubberband', () => {
    for (const o of [-300, -12, 0, 7, 250]) expect(unrubberband(rubberband(o, 500), 500)).toBeCloseTo(o, 4);
  });
});
