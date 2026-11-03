/**
 * Spring physics in Apple's terms: `response` (seconds, roughly how quickly the value gets there)
 * and `damping` (fraction; 1 = no overshoot, below 1 = bounce). Everything the user can touch
 * animates with these, starting from the live value and velocity, so it can be grabbed and
 * redirected at any moment.
 */

export interface SpringParams {
  response: number;
  damping: number;
}

/** House springs. Defaults are critically damped; bounce only where a flick carried momentum. */
export const springs = {
  /** Repositioning, morphs, screen pushes. */
  smooth: { response: 0.4, damping: 1 },
  /** The brief's starting point for sheets and toolbars. */
  default: { response: 0.4, damping: 0.8 },
  /** Sheet detents after a drag (Apple ships 0.3 / 0.8 for drawers). */
  sheet: { response: 0.32, damping: 0.86 },
  /** Small controls: switches, segmented thumbs. */
  snappy: { response: 0.28, damping: 0.82 },
  /** Photo zoom/pan settle and rubber-band return. */
  canvas: { response: 0.36, damping: 1 },
} satisfies Record<string, SpringParams>;

export interface SpringState {
  x: number;
  v: number;
}

/**
 * Closed-form damped harmonic oscillator. Returns position and velocity `t` seconds after
 * starting at `from` with velocity `v0`, heading for `to`. Unit mass.
 */
export function solveSpring(p: SpringParams, from: number, to: number, v0: number) {
  const w0 = (2 * Math.PI) / Math.max(p.response, 0.001);
  const z = Math.max(p.damping, 0);
  const d0 = from - to;

  if (z < 1) {
    const wd = w0 * Math.sqrt(1 - z * z);
    const a = d0;
    const b = (v0 + z * w0 * d0) / wd;
    return (t: number): SpringState => {
      const e = Math.exp(-z * w0 * t);
      const c = Math.cos(wd * t);
      const s = Math.sin(wd * t);
      const d = e * (a * c + b * s);
      const v = e * ((b * wd - z * w0 * a) * c - (a * wd + z * w0 * b) * s);
      return { x: to + d, v };
    };
  }

  if (z === 1) {
    const b = v0 + w0 * d0;
    return (t: number): SpringState => {
      const e = Math.exp(-w0 * t);
      const d = e * (d0 + b * t);
      const v = e * (b - w0 * (d0 + b * t));
      return { x: to + d, v };
    };
  }

  const s = Math.sqrt(z * z - 1);
  const r1 = -w0 * (z - s);
  const r2 = -w0 * (z + s);
  const c2 = (v0 - r1 * d0) / (r2 - r1);
  const c1 = d0 - c2;
  return (t: number): SpringState => {
    const e1 = Math.exp(r1 * t);
    const e2 = Math.exp(r2 * t);
    return { x: to + c1 * e1 + c2 * e2, v: c1 * r1 * e1 + c2 * r2 * e2 };
  };
}

/** Time for a spring from rest to settle within `epsilon` of a unit distance. */
export function settleTime(p: SpringParams, epsilon = 0.001): number {
  const f = solveSpring(p, 0, 1, 0);
  const step = 1 / 120;
  let quiet = 0;
  for (let t = 0; t < 10; t += step) {
    const { x, v } = f(t);
    if (Math.abs(1 - x) < epsilon && Math.abs(v) < epsilon * 10) {
      quiet += step;
      if (quiet > 0.05) return t;
    } else {
      quiet = 0;
    }
  }
  return 10;
}

let linearSupported: boolean | undefined;
function supportsLinear() {
  if (linearSupported === undefined) {
    linearSupported =
      typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('transition-timing-function', 'linear(0, 1)');
  }
  return linearSupported;
}

/**
 * A spring from rest as a CSS easing, for transitions nobody's finger is driving (menus
 * appearing, toolbar morphs). Uses linear() where WebKit has it (Safari 17.2+), otherwise a
 * cubic-bezier that's close for critically damped springs.
 */
export function springEasing(p: SpringParams): { easing: string; duration: number } {
  const duration = settleTime(p);
  const f = solveSpring(p, 0, 1, 0);
  if (!supportsLinear()) {
    return { easing: p.damping < 0.9 ? 'cubic-bezier(0.2, 0.9, 0.25, 1.08)' : 'cubic-bezier(0.25, 0.9, 0.3, 1)', duration };
  }
  const n = Math.min(60, Math.max(16, Math.round(duration * 40)));
  const pts: string[] = [];
  for (let i = 0; i <= n; i++) {
    const x = f((i / n) * duration).x;
    pts.push(String(Math.round(x * 10000) / 10000));
  }
  pts[pts.length - 1] = '1';
  return { easing: `linear(${pts.join(', ')})`, duration };
}

/** Where a flick would come to rest (Apple's projection from Designing Fluid Interfaces). */
export function project(velocity: number, decelerationRate = 0.998): number {
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

/** Resistance past a boundary: the further you pull, the less it follows. */
export function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  if (dimension <= 0) return 0;
  const sign = Math.sign(overshoot);
  const o = Math.abs(overshoot);
  return (sign * (o * dimension * constant)) / (dimension + constant * o);
}

/** Inverse of rubberband(): the raw overshoot that displays as `shown`. */
export function unrubberband(shown: number, dimension: number, constant = 0.55): number {
  const sign = Math.sign(shown);
  const s = Math.min(Math.abs(shown), dimension * 0.999);
  return (sign * (s * dimension)) / (constant * (dimension - s));
}

export const prefersReducedMotion = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * A value that animates with a spring on the display clock and can be retargeted mid-flight
 * without a jump or a velocity "brick wall": a new target restarts the solver from the live
 * position and velocity.
 */
export class SpringValue {
  private from = 0;
  private to = 0;
  private v0 = 0;
  private start = 0;
  private solver: ((t: number) => SpringState) | null = null;
  private raf = 0;
  private resolveDone: (() => void) | null = null;
  value: number;
  velocity = 0;
  params: SpringParams;
  restDelta: number;

  constructor(
    initial: number,
    private onChange: (value: number) => void,
    params: SpringParams = springs.default,
    restDelta = 0.25,
  ) {
    this.value = initial;
    this.to = initial;
    this.params = params;
    this.restDelta = restDelta;
  }

  get target() {
    return this.to;
  }

  get animating() {
    return this.solver !== null;
  }

  /** Jump without animating (e.g. 1:1 finger tracking). Stops any running spring. */
  set(value: number, velocity = 0) {
    this.stop();
    this.value = value;
    this.velocity = velocity;
    this.to = value;
    this.onChange(value);
  }

  /** Spring to `target`, starting from the live value. Pass the finger's velocity on release. */
  animateTo(target: number, opts: { velocity?: number; params?: SpringParams } = {}): Promise<void> {
    this.sample();
    if (opts.params) this.params = opts.params;
    this.from = this.value;
    this.to = target;
    this.v0 = opts.velocity ?? this.velocity;

    if (prefersReducedMotion()) {
      // Reduce Motion: no travel, no bounce. Land immediately; callers fade instead.
      this.set(target);
      return Promise.resolve();
    }

    this.solver = solveSpring(this.params, this.from, this.to, this.v0);
    this.start = performance.now();
    if (!this.raf) this.raf = requestAnimationFrame(this.tick);
    this.resolveDone?.();
    return new Promise((resolve) => {
      this.resolveDone = resolve;
    });
  }

  stop() {
    this.sample();
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.solver = null;
    const r = this.resolveDone;
    this.resolveDone = null;
    r?.();
  }

  /** Update value/velocity from the running solver at the current time. */
  private sample() {
    if (!this.solver) return;
    const t = (performance.now() - this.start) / 1000;
    const s = this.solver(t);
    this.value = s.x;
    this.velocity = s.v;
  }

  private tick = () => {
    this.raf = 0;
    if (!this.solver) return;
    this.sample();
    const settled = Math.abs(this.value - this.to) < this.restDelta && Math.abs(this.velocity) < this.restDelta * 8;
    if (settled) {
      this.value = this.to;
      this.velocity = 0;
      this.solver = null;
      this.onChange(this.value);
      const r = this.resolveDone;
      this.resolveDone = null;
      r?.();
      return;
    }
    this.onChange(this.value);
    this.raf = requestAnimationFrame(this.tick);
  };
}

/** Recent pointer samples, for release velocity in px/s. */
export class VelocityTracker {
  private samples: { t: number; x: number; y: number }[] = [];

  reset() {
    this.samples.length = 0;
  }

  add(x: number, y: number, t = performance.now()) {
    this.samples.push({ t, x, y });
    const cutoff = t - 100;
    while (this.samples.length > 2 && this.samples[0].t < cutoff) this.samples.shift();
  }

  velocity(now = performance.now()): { x: number; y: number } {
    const s = this.samples;
    if (s.length < 2) return { x: 0, y: 0 };
    const last = s[s.length - 1];
    // A finger that stopped before lifting has no velocity.
    if (now - last.t > 60) return { x: 0, y: 0 };
    const first = s[0];
    const dt = (last.t - first.t) / 1000;
    if (dt <= 0) return { x: 0, y: 0 };
    return { x: (last.x - first.x) / dt, y: (last.y - first.y) / dt };
  }
}

/** Run a WAAPI animation with a spring easing (or a short fade under Reduce Motion). */
export function springAnimate(
  el: Element,
  keyframes: Keyframe[],
  p: SpringParams = springs.smooth,
  extra: KeyframeAnimationOptions = {},
): Animation {
  if (prefersReducedMotion()) {
    const fade = keyframes.map((k) => ({ opacity: k.opacity ?? 1 }));
    return el.animate(fade, { duration: 180, easing: 'ease-out', fill: 'both', ...extra });
  }
  const { easing, duration } = springEasing(p);
  const a = el.animate(keyframes, { duration: duration * 1000, easing, fill: 'both', ...extra });
  // Once finished, write the end state as plain styles and drop the animation. A finished
  // animation left holding a transform keeps its own layer, which WebKit can rasterise soft.
  a.finished.then(
    () => {
      try {
        if (el.isConnected) a.commitStyles();
        a.cancel();
      } catch {
        /* element went away */
      }
    },
    () => {},
  );
  return a;
}
