import { SpringValue, VelocityTracker, rubberband, springs, unrubberband } from '../design/motion';
import { ViewTransform, type Insets } from './viewTransform';

type Level = ImageBitmap | HTMLCanvasElement;

interface Pt {
  x: number;
  y: number;
}

const SMALLEST_SIDE = 128;

/** Pencil pressure when there is one; a steady middle value for fingers and mice. */
const pressureOf = (e: PointerEvent) => (e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 0.5);
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_SLOP = 30;
const DECAY_PER_MS = 0.998;

/** Single-finger input for the active tool, in image coordinates. Return false from down() to let the finger pan instead. */
export interface CanvasInput {
  down(p: { x: number; y: number; pressure: number; pointerType: string }): boolean | void;
  move(p: { x: number; y: number; pressure: number; pointerType: string }): void;
  up(p: { x: number; y: number; pressure: number; pointerType: string }): void;
  cancel(): void;
}

export type Overlay = (ctx: CanvasRenderingContext2D, view: CanvasView) => void;

export interface CanvasViewEvents {
  /** Zoom or position changed (every frame while moving). */
  onChange?: (view: CanvasView) => void;
  /** Gestures and animations have come to rest. */
  onSettle?: (view: CanvasView) => void;
}

/**
 * Draws the photo into a viewport-sized canvas (never a full-size copy) and handles direct
 * manipulation: pinch around the fingers, pan with momentum, rubber-band at the edges and at
 * the zoom limits, double-tap between fit and 100%. Zoomed-out views draw from half-size copies
 * (a mip pyramid) so huge photos stay sharp and fast. Port of the Windows DisplayPyramid and
 * ViewTransform ideas.
 */
export class CanvasView {
  readonly vt = new ViewTransform();
  private ctx: CanvasRenderingContext2D;
  private levels: Level[] = [];
  private raf = 0;
  private bg = '#000';
  private ro: ResizeObserver;
  private pointers = new Map<number, Pt>();
  private tracker = new VelocityTracker();
  private pan: { start: Pt; raw0: Pt } | null = null;
  private pinch: { d0: number; z0: number; img: Pt; raw0: Pt; c0: Pt } | null = null;
  private lastCentroid: Pt = { x: 0, y: 0 };
  private tap: { t: number; p: Pt; moved: boolean } | null = null;
  private lastTap: { t: number; p: Pt } | null = null;
  private momentum = 0;
  private bounceX: SpringValue;
  private bounceY: SpringValue;
  private settleSpring: SpringValue;
  private settleFrom = { z: 1, x: 0, y: 0 };
  private settleTo = { z: 1, x: 0, y: 0 };
  private settleTimer = 0;
  private destroyed = false;
  private overlays = new Set<Overlay>();
  private listeners = new Set<(v: CanvasView) => void>();
  private rebuildTimer = 0;
  private checker: CanvasPattern | null = null;
  private toolActive = false;
  /** Single-finger input goes to the tool when set; two fingers always navigate. */
  input: CanvasInput | null = null;
  /** Draw a checkerboard under the photo (transparent areas). */
  transparent = false;
  /** Straighten preview: rotation in radians and the inner-rectangle scale. */
  previewRotation = 0;
  previewScale = 1;

  constructor(
    readonly canvas: HTMLCanvasElement,
    private events: CanvasViewEvents = {},
  ) {
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true } as CanvasRenderingContext2DSettings);
    if (!ctx) throw new Error('Canvas 2D is not available');
    this.ctx = ctx;
    this.vt.dpr = Math.max(1, window.devicePixelRatio || 1);
    this.bounceX = new SpringValue(0, (v) => this.setAxis('x', v), springs.canvas, 0.3);
    this.bounceY = new SpringValue(0, (v) => this.setAxis('y', v), springs.canvas, 0.3);
    this.settleSpring = new SpringValue(0, (s) => this.applySettle(s), springs.canvas, 0.0015);
    this.readBackground();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.resize();

    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('keydown', this.onKey);
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', this.onScheme);
  }

  destroy() {
    this.destroyed = true;
    this.ro.disconnect();
    cancelAnimationFrame(this.raf);
    cancelAnimationFrame(this.momentum);
    clearTimeout(this.settleTimer);
    clearTimeout(this.rebuildTimer);
    this.bounceX.stop();
    this.bounceY.stop();
    this.settleSpring.stop();
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('pointerup', this.onUp);
    this.canvas.removeEventListener('pointercancel', this.onUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('keydown', this.onKey);
    matchMedia('(prefers-color-scheme: dark)').removeEventListener('change', this.onScheme);
    this.freeLevels();
    // Release the backing store now; iOS counts canvas memory globally.
    this.canvas.width = 0;
    this.canvas.height = 0;
  }

  /** Show a picture. The caller owns `src` and must keep it alive while shown. */
  setSource(src: Level, refit = true) {
    this.freeLevels();
    this.levels = [src];
    this.vt.setImage(src.width, src.height, refit);
    this.buildLevelsSoon();
    this.requestRender();
    this.queueSettle();
  }

  /** Back-compat for callers holding an ImageBitmap. */
  setImage(bitmap: ImageBitmap) {
    this.setSource(bitmap, true);
  }

  /**
   * The picture's pixels changed (or it was swapped for one of another size). Copies made for
   * zoomed-out drawing are dropped now and rebuilt once things go quiet.
   */
  invalidate(src?: Level, opts: { refit?: boolean } = {}) {
    const next = src ?? this.levels[0];
    if (!next) return;
    const sizeChanged = next.width !== this.vt.imageWidth || next.height !== this.vt.imageHeight;
    this.freeLevels();
    this.levels = [next];
    if (sizeChanged) this.vt.setImage(next.width, next.height, opts.refit ?? true);
    clearTimeout(this.rebuildTimer);
    this.rebuildTimer = window.setTimeout(() => this.buildLevelsSoon(), 220);
    this.requestRender();
    this.queueSettle();
  }

  addOverlay(fn: Overlay): () => void {
    this.overlays.add(fn);
    this.requestRender();
    return () => {
      this.overlays.delete(fn);
      this.requestRender();
    };
  }

  subscribe(fn: (v: CanvasView) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Image coordinates under a point on screen. */
  clientToImage(clientX: number, clientY: number) {
    const r = this.canvas.getBoundingClientRect();
    return this.vt.viewToImage(clientX - r.left, clientY - r.top);
  }

  /** Screen rectangle (CSS px, relative to the canvas) of an image rectangle. */
  imageRectToView(x: number, y: number, w: number, h: number) {
    const a = this.vt.imageToView(x, y);
    return { x: a.x, y: a.y, w: w * this.vt.zoom, h: h * this.vt.zoom };
  }

  /**
   * Area covered by floating chrome. With `follow`, the fit tracks it frame by frame (used while
   * a sheet moves); otherwise a fitted view springs to the new fit.
   */
  setInsets(insets: Insets, follow = false) {
    if (this.vt.isFitted && !this.isInteracting()) {
      if (follow) {
        this.vt.setInsets(insets);
        this.requestRender();
        this.queueSettle();
      } else {
        const from = { z: this.vt.zoom, x: this.vt.offsetX, y: this.vt.offsetY };
        this.vt.setInsets(insets);
        const to = { z: this.vt.zoom, x: this.vt.offsetX, y: this.vt.offsetY };
        this.animateState(from, to, true);
      }
    } else {
      this.vt.insets = { ...insets };
      this.queueSettle();
    }
  }

  fit() {
    const from = this.state();
    this.vt.fit();
    this.animateState(from, this.state(), true);
  }

  get hasImage() {
    return this.levels.length > 0;
  }

  // ---------- rendering ----------

  private onScheme = () => {
    this.readBackground();
    this.requestRender();
  };

  private readBackground() {
    const v = getComputedStyle(this.canvas).getPropertyValue('--canvas-bg').trim();
    this.bg = v || '#000';
  }

  private resize() {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    this.vt.dpr = dpr;
    const w = Math.round(r.width * dpr);
    const h = Math.round(r.height * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.vt.setViewport(r.width, r.height);
    this.render();
  }

  requestRender() {
    if (this.raf || this.destroyed) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.render();
    });
  }

  private render() {
    const { ctx, canvas, vt } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = this.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const src = this.levels[0];
    if (!src) return;
    const dpr = vt.dpr;
    if (this.previewRotation) {
      this.renderRotated();
      this.events.onChange?.(this);
      for (const l of this.listeners) l(this);
      return;
    }
    const deviceZoom = vt.zoom * dpr;
    const img = this.levelFor(deviceZoom);
    const iw = img.width;
    const ih = img.height;

    // Destination rect of the whole image, in device pixels.
    const dx = vt.offsetX * dpr;
    const dy = vt.offsetY * dpr;
    const dw = vt.imageWidth * vt.zoom * dpr;
    const dh = vt.imageHeight * vt.zoom * dpr;

    // Only ask for the visible part of the source.
    const sx0 = Math.max(0, (-dx / dw) * iw);
    const sy0 = Math.max(0, (-dy / dh) * ih);
    const sx1 = Math.min(iw, ((canvas.width - dx) / dw) * iw);
    const sy1 = Math.min(ih, ((canvas.height - dy) / dh) * ih);
    if (sx1 <= sx0 || sy1 <= sy0) {
      this.drawOverlays(dx, dy, vt.zoom * dpr);
      this.events.onChange?.(this);
      for (const l of this.listeners) l(this);
      return;
    }

    if (this.transparent) this.drawChecker(Math.max(0, dx), Math.max(0, dy), Math.min(canvas.width, dx + dw) - Math.max(0, dx), Math.min(canvas.height, dy + dh) - Math.max(0, dy));
    ctx.imageSmoothingEnabled = deviceZoom < 3;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(
      img,
      sx0,
      sy0,
      sx1 - sx0,
      sy1 - sy0,
      dx + (sx0 / iw) * dw,
      dy + (sy0 / ih) * dh,
      ((sx1 - sx0) / iw) * dw,
      ((sy1 - sy0) / ih) * dh,
    );
    this.drawOverlays(dx, dy, vt.zoom * dpr);
    this.events.onChange?.(this);
    for (const l of this.listeners) l(this);
  }

  private drawOverlays(dx: number, dy: number, k: number) {
    if (!this.overlays.size) return;
    const ctx = this.ctx;
    for (const o of this.overlays) {
      ctx.save();
      ctx.setTransform(k, 0, 0, k, dx, dy);
      o(ctx, this);
      ctx.restore();
    }
  }

  private drawChecker(x: number, y: number, w: number, h: number) {
    if (w <= 0 || h <= 0) return;
    const ctx = this.ctx;
    if (!this.checker) {
      const cell = Math.round(8 * this.vt.dpr);
      const t = document.createElement('canvas');
      t.width = t.height = cell * 2;
      const tc = t.getContext('2d')!;
      tc.fillStyle = '#ffffff';
      tc.fillRect(0, 0, cell * 2, cell * 2);
      tc.fillStyle = '#d6d6db';
      tc.fillRect(0, 0, cell, cell);
      tc.fillRect(cell, cell, cell, cell);
      this.checker = ctx.createPattern(t, 'repeat');
    }
    if (!this.checker) return;
    ctx.fillStyle = this.checker;
    ctx.fillRect(x, y, w, h);
  }

  /** Straighten preview: what the result will look like, inside the photo's frame. */
  private renderRotated() {
    const { ctx, vt } = this;
    const dpr = vt.dpr;
    const k = vt.zoom * dpr;
    const dx = vt.offsetX * dpr;
    const dy = vt.offsetY * dpr;
    const w = vt.imageWidth;
    const h = vt.imageHeight;
    ctx.save();
    ctx.setTransform(k, 0, 0, k, dx, dy);
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.clip();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(this.previewRotation);
    ctx.scale(1 / this.previewScale, 1 / this.previewScale);
    ctx.translate(-w / 2, -h / 2);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.levelFor(k / this.previewScale), 0, 0, w, h);
    for (const o of this.overlays) {
      ctx.save();
      o(ctx, this);
      ctx.restore();
    }
    ctx.restore();
  }

  /** The smallest copy that still has at least one pixel per device pixel. */
  private levelFor(deviceZoom: number): Level {
    let wanted = 0;
    let scale = deviceZoom;
    while (scale <= 0.5 && wanted + 1 < this.levels.length) {
      scale *= 2;
      wanted++;
    }
    return this.levels[wanted];
  }

  private buildLevelsSoon() {
    const src = this.levels[0];
    if (!src || this.levels.length > 1) return;
    const step = () => {
      if (this.destroyed || this.levels[0] !== src) return;
      const prev = this.levels[this.levels.length - 1];
      const w = Math.floor(prev.width / 2);
      const h = Math.floor(prev.height / 2);
      if (Math.max(w, h) >= SMALLEST_SIDE) {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const cx = c.getContext('2d')!;
        cx.imageSmoothingQuality = 'high';
        cx.drawImage(prev, 0, 0, w, h);
        this.levels.push(c);
        this.requestRender();
        setTimeout(step, 0);
      } else {
        this.queueSettle();
      }
    };
    setTimeout(step, 16);
  }

  private freeLevels() {
    for (let i = 1; i < this.levels.length; i++) {
      const l = this.levels[i];
      if (l instanceof HTMLCanvasElement) l.width = l.height = 0;
    }
    this.levels = [];
  }

  // ---------- gestures ----------

  private isInteracting() {
    return this.pointers.size > 0 || this.momentum !== 0 || this.bounceX.animating || this.bounceY.animating;
  }

  private state() {
    return { z: this.vt.zoom, x: this.vt.offsetX, y: this.vt.offsetY };
  }

  private local(e: PointerEvent): Pt {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private centroid(): Pt {
    let x = 0;
    let y = 0;
    for (const p of this.pointers.values()) {
      x += p.x;
      y += p.y;
    }
    const n = this.pointers.size || 1;
    return { x: x / n, y: y / n };
  }

  private distance(): number {
    const [a, b] = [...this.pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  private stopMotion() {
    cancelAnimationFrame(this.momentum);
    this.momentum = 0;
    this.bounceX.stop();
    this.bounceY.stop();
    this.settleSpring.stop();
    clearTimeout(this.settleTimer);
  }

  /** Raw (pre-rubber-band) offset for a displayed offset, so grabbing mid-bounce doesn't jump. */
  private rawOffset(): Pt {
    const l = this.vt.limits;
    const raw = (v: number, lo: number, hi: number, dim: number) =>
      v > hi ? hi + unrubberband(v - hi, dim) : v < lo ? lo + unrubberband(v - lo, dim) : v;
    return {
      x: raw(this.vt.offsetX, l.minX, l.maxX, this.vt.viewportWidth),
      y: raw(this.vt.offsetY, l.minY, l.maxY, this.vt.viewportHeight),
    };
  }

  /** Displayed offset for a raw one: free inside the limits, resisting beyond them. */
  private applyRaw(raw: Pt, zoom: number) {
    const l = this.vt.limitsAt(zoom);
    const show = (v: number, lo: number, hi: number, dim: number) =>
      v > hi ? hi + rubberband(v - hi, dim) : v < lo ? lo + rubberband(v - lo, dim) : v;
    this.vt.zoom = zoom;
    this.vt.offsetX = show(raw.x, l.minX, l.maxX, this.vt.viewportWidth);
    this.vt.offsetY = show(raw.y, l.minY, l.maxY, this.vt.viewportHeight);
  }

  /** Zoom with resistance past the limits (on a log scale, so it feels the same in and out). */
  private softZoom(z: number): number {
    const lo = this.vt.minZoom;
    const hi = this.vt.maxZoom;
    if (z < lo) return lo * Math.exp(rubberband(Math.log(z / lo), 1, 0.55));
    if (z > hi) return hi * Math.exp(rubberband(Math.log(z / hi), 1, 0.55));
    return z;
  }

  private beginPan(p: Pt) {
    this.pan = { start: p, raw0: this.rawOffset() };
    this.tracker.reset();
    this.tracker.add(p.x, p.y);
  }

  private beginPinch() {
    const c = this.centroid();
    this.pinch = {
      d0: Math.max(1, this.distance()),
      z0: this.vt.zoom,
      img: this.vt.viewToImage(c.x, c.y),
      raw0: this.rawOffset(),
      c0: c,
    };
    this.pan = null;
  }

  private onDown = (e: PointerEvent) => {
    if (!this.hasImage || (e.pointerType === 'mouse' && e.button !== 0)) return;
    this.canvas.setPointerCapture(e.pointerId);
    this.stopMotion();
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    if (this.pointers.size === 1 && this.input) {
      const ip = this.vt.viewToImage(p.x, p.y);
      const taken = this.input.down({ ...ip, pressure: pressureOf(e), pointerType: e.pointerType });
      if (taken !== false) {
        this.toolActive = true;
        return;
      }
    }
    this.vt.isFitted = false;
    if (this.pointers.size === 1) {
      this.beginPan(p);
      this.tap = { t: performance.now(), p, moved: false };
    } else if (this.pointers.size === 2) {
      if (this.toolActive) {
        // A second finger means navigate, not draw.
        this.input?.cancel();
        this.toolActive = false;
      }
      this.vt.isFitted = false;
      this.tap = null;
      this.beginPinch();
    }
  };

  private onMove = (e: PointerEvent) => {
    if (!this.pointers.has(e.pointerId)) return;
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    if (this.toolActive && this.input) {
      const ip = this.vt.viewToImage(p.x, p.y);
      this.input.move({ ...ip, pressure: pressureOf(e), pointerType: e.pointerType });
      return;
    }
    if (this.tap && Math.hypot(p.x - this.tap.p.x, p.y - this.tap.p.y) > 8) this.tap.moved = true;

    if (this.pinch && this.pointers.size >= 2) {
      const c = this.centroid();
      this.lastCentroid = c;
      const z = this.softZoom(this.pinch.z0 * (this.distance() / this.pinch.d0));
      // Keep the image point that was under the fingers under them.
      const raw = { x: c.x - this.pinch.img.x * z, y: c.y - this.pinch.img.y * z };
      this.applyRaw(raw, z);
      this.requestRender();
    } else if (this.pan) {
      const raw = { x: this.pan.raw0.x + (p.x - this.pan.start.x), y: this.pan.raw0.y + (p.y - this.pan.start.y) };
      this.applyRaw(raw, this.vt.zoom);
      this.tracker.add(p.x, p.y);
      this.requestRender();
    }
  };

  private onUp = (e: PointerEvent) => {
    if (!this.pointers.has(e.pointerId)) return;
    const p = this.local(e);
    this.pointers.delete(e.pointerId);

    if (this.toolActive) {
      this.toolActive = false;
      const ip = this.vt.viewToImage(p.x, p.y);
      if (e.type === 'pointercancel') this.input?.cancel();
      else this.input?.up({ ...ip, pressure: pressureOf(e), pointerType: e.pointerType });
      return;
    }

    if (this.pointers.size === 1) {
      // Lifted one finger of a pinch: carry on panning with the other.
      const [rest] = [...this.pointers.values()];
      this.pinch = null;
      this.beginPan(rest);
      return;
    }
    if (this.pointers.size > 1) {
      this.beginPinch();
      return;
    }

    const wasPinch = this.pinch !== null;
    this.pinch = null;
    const tap = this.tap;
    this.tap = null;
    this.pan = null;

    if (tap && !tap.moved && performance.now() - tap.t < 250) {
      const now = performance.now();
      if (this.lastTap && now - this.lastTap.t < DOUBLE_TAP_MS && Math.hypot(p.x - this.lastTap.p.x, p.y - this.lastTap.p.y) < DOUBLE_TAP_SLOP) {
        this.lastTap = null;
        this.doubleTap(p);
        return;
      }
      this.lastTap = { t: now, p };
    }

    if (wasPinch) {
      this.settle(this.lastCentroid);
      return;
    }
    const v = this.tracker.velocity();
    if (Math.hypot(v.x, v.y) > 60) this.fling(v);
    else this.settle(p);
  };

  private onWheel = (e: WheelEvent) => {
    if (!this.hasImage) return;
    e.preventDefault();
    this.stopMotion();
    const p = { x: e.offsetX, y: e.offsetY };
    if (e.ctrlKey || e.metaKey) {
      this.vt.zoomAt(p.x, p.y, this.vt.zoom * Math.exp(-e.deltaY * 0.01));
    } else {
      this.vt.panBy(-e.deltaX, -e.deltaY);
    }
    this.requestRender();
    this.queueSettle();
  };

  /** Keyboard equivalents: + and - zoom, 0 fits, 1 is 100%, arrows pan. */
  private onKey = (e: KeyboardEvent) => {
    if (!this.hasImage) return;
    const c = { x: this.vt.viewportWidth / 2, y: this.vt.viewportHeight / 2 };
    const from = this.state();
    const step = 48;
    switch (e.key) {
      case '+':
      case '=':
        this.vt.zoomAt(c.x, c.y, this.vt.zoom * 1.5);
        break;
      case '-':
        this.vt.zoomAt(c.x, c.y, this.vt.zoom / 1.5);
        break;
      case '0':
        this.vt.fit();
        break;
      case '1':
        this.vt.zoomAt(c.x, c.y, this.vt.actualZoom);
        break;
      case 'ArrowLeft':
        this.vt.panBy(step, 0);
        break;
      case 'ArrowRight':
        this.vt.panBy(-step, 0);
        break;
      case 'ArrowUp':
        this.vt.panBy(0, step);
        break;
      case 'ArrowDown':
        this.vt.panBy(0, -step);
        break;
      default:
        return;
    }
    e.preventDefault();
    this.animateState(from, this.state(), this.vt.isFitted);
  };

  private doubleTap(p: Pt) {
    const fit = this.vt.fitZoom;
    const from = this.state();
    if (this.vt.zoom > fit * 1.05) {
      this.vt.fit();
      this.animateState(from, this.state(), true);
      return;
    }
    const actual = this.vt.actualZoom;
    const target = actual > fit * 1.2 ? actual : fit * 2.5;
    this.vt.zoomAt(p.x, p.y, target);
    this.animateState(from, this.state(), false);
  }

  /** Spring back inside the zoom and pan limits, keeping `anchor` steady. */
  private settle(anchor: Pt) {
    const from = this.state();
    const z = Math.min(this.vt.maxZoom, Math.max(this.vt.minZoom, this.vt.zoom));
    const ix = (anchor.x - this.vt.offsetX) / this.vt.zoom;
    const iy = (anchor.y - this.vt.offsetY) / this.vt.zoom;
    const l = this.vt.limitsAt(z);
    const to = {
      z,
      x: Math.min(l.maxX, Math.max(l.minX, anchor.x - ix * z)),
      y: Math.min(l.maxY, Math.max(l.minY, anchor.y - iy * z)),
    };
    const fitted = Math.abs(z - this.vt.fitZoom) < 1e-6;
    if (Math.abs(from.z - to.z) < 1e-6 && Math.abs(from.x - to.x) < 0.25 && Math.abs(from.y - to.y) < 0.25) {
      this.vt.isFitted = fitted;
      this.queueSettle();
      return;
    }
    this.animateState(from, to, fitted);
  }

  /** Animate zoom geometrically and position linearly, as one spring, so they arrive together. */
  private animateState(from: { z: number; x: number; y: number }, to: { z: number; x: number; y: number }, fitted: boolean) {
    this.settleFrom = from;
    this.settleTo = to;
    this.vt.zoom = from.z;
    this.vt.offsetX = from.x;
    this.vt.offsetY = from.y;
    this.settleSpring.set(0);
    this.settleSpring.animateTo(1, { params: springs.canvas }).then(() => {
      if (this.settleSpring.value === 1) {
        this.vt.isFitted = fitted;
        this.queueSettle();
      }
    });
  }

  private applySettle(s: number) {
    const a = this.settleFrom;
    const b = this.settleTo;
    this.vt.zoom = a.z * Math.pow(b.z / a.z, s);
    this.vt.offsetX = a.x + (b.x - a.x) * s;
    this.vt.offsetY = a.y + (b.y - a.y) * s;
    this.requestRender();
  }

  /** Momentum: decelerate like a scroll view, and bounce off the edges with the speed it had. */
  private fling(v0: Pt) {
    let vx = v0.x;
    let vy = v0.y;
    let last = performance.now();
    let xDone = false;
    let yDone = false;
    const step = () => {
      const now = performance.now();
      const dt = Math.min(32, now - last);
      last = now;
      const decay = Math.pow(DECAY_PER_MS, dt);
      const l = this.vt.limits;
      if (!xDone) {
        vx *= decay;
        this.vt.offsetX += (vx * dt) / 1000;
        if (this.vt.offsetX > l.maxX || this.vt.offsetX < l.minX) {
          xDone = true;
          this.bounceX.set(this.vt.offsetX);
          this.bounceX.animateTo(this.vt.offsetX > l.maxX ? l.maxX : l.minX, { velocity: vx, params: springs.canvas });
        } else if (Math.abs(vx) < 8) xDone = true;
      }
      if (!yDone) {
        vy *= decay;
        this.vt.offsetY += (vy * dt) / 1000;
        if (this.vt.offsetY > l.maxY || this.vt.offsetY < l.minY) {
          yDone = true;
          this.bounceY.set(this.vt.offsetY);
          this.bounceY.animateTo(this.vt.offsetY > l.maxY ? l.maxY : l.minY, { velocity: vy, params: springs.canvas });
        } else if (Math.abs(vy) < 8) yDone = true;
      }
      this.requestRender();
      if (xDone && yDone) {
        this.momentum = 0;
        this.queueSettle();
        return;
      }
      this.momentum = requestAnimationFrame(step);
    };
    // A flick that starts out of bounds (released mid rubber-band) springs straight back.
    const l = this.vt.limits;
    if (this.vt.offsetX > l.maxX || this.vt.offsetX < l.minX) {
      xDone = true;
      this.bounceX.set(this.vt.offsetX);
      this.bounceX.animateTo(this.vt.offsetX > l.maxX ? l.maxX : l.minX, { velocity: vx, params: springs.canvas });
    }
    if (this.vt.offsetY > l.maxY || this.vt.offsetY < l.minY) {
      yDone = true;
      this.bounceY.set(this.vt.offsetY);
      this.bounceY.animateTo(this.vt.offsetY > l.maxY ? l.maxY : l.minY, { velocity: vy, params: springs.canvas });
    }
    this.momentum = requestAnimationFrame(step);
  }

  private setAxis(axis: 'x' | 'y', v: number) {
    if (axis === 'x') this.vt.offsetX = v;
    else this.vt.offsetY = v;
    this.requestRender();
    if (!this.bounceX.animating && !this.bounceY.animating && !this.momentum) this.queueSettle();
  }

  /** Report rest once nothing has moved for a beat. */
  private queueSettle() {
    clearTimeout(this.settleTimer);
    this.settleTimer = window.setTimeout(() => {
      if (this.isInteracting() || this.settleSpring.animating) return;
      this.events.onSettle?.(this);
    }, 90);
  }
}
