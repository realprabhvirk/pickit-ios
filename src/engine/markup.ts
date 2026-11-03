/**
 * Vector markup in image coordinates. Elements are plain objects (so they save to IndexedDB
 * as-is) and immutable: an edit makes a new element, so undo only has to remember lists.
 * The same draw code renders the screen and the exported file. Ported in spirit from
 * PicKit for Windows (Markup/*).
 */
export type MarkupKind = 'pen' | 'highlight' | 'line' | 'arrow' | 'rect' | 'ellipse' | 'text';

export interface MarkupStyle {
  color: string;
  width: number;
}

interface Base {
  id: string;
  style: MarkupStyle;
}

export interface StrokeEl extends Base {
  kind: 'pen' | 'highlight';
  /** x, y, pressure triples. Pressure 0..1; 0.5 when the device doesn't report it. */
  points: number[];
}

export interface LineEl extends Base {
  kind: 'line' | 'arrow';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface ShapeEl extends Base {
  kind: 'rect' | 'ellipse';
  x: number;
  y: number;
  w: number;
  h: number;
}

export type TextFont = 'system' | 'rounded' | 'serif' | 'mono' | 'marker' | 'hand';

export interface TextEl extends Base {
  kind: 'text';
  x: number;
  y: number;
  text: string;
  font: TextFont;
  /** Font size in image pixels. */
  size: number;
}

export type MarkupEl = StrokeEl | LineEl | ShapeEl | TextEl;

export const FONTS: { id: TextFont; name: string; css: string; weight: number }[] = [
  { id: 'system', name: 'System', css: "-apple-system, system-ui, 'Helvetica Neue', sans-serif", weight: 600 },
  { id: 'rounded', name: 'Rounded', css: "ui-rounded, 'SF Pro Rounded', -apple-system, system-ui, sans-serif", weight: 700 },
  { id: 'serif', name: 'Serif', css: "ui-serif, 'New York', Georgia, serif", weight: 600 },
  { id: 'mono', name: 'Mono', css: "ui-monospace, 'SF Mono', Menlo, monospace", weight: 600 },
  { id: 'marker', name: 'Marker', css: "'Marker Felt', 'Chalkboard SE', 'Comic Sans MS', cursive", weight: 400 },
  { id: 'hand', name: 'Handwriting', css: "'Noteworthy', 'Bradley Hand', 'Segoe Print', cursive", weight: 400 },
];

let idSeq = 0;
export const newId = () => `m${Date.now().toString(36)}${(idSeq++).toString(36)}`;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

// ---------- geometry ----------

export function distanceToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 <= 1e-9) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

let measureCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
function measurer() {
  if (!measureCtx) {
    measureCtx =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(1, 1).getContext('2d')
        : typeof document !== 'undefined'
          ? document.createElement('canvas').getContext('2d')
          : null;
  }
  return measureCtx;
}

export function fontFor(el: TextEl) {
  const f = FONTS.find((x) => x.id === el.font) ?? FONTS[0];
  return `${f.weight} ${Math.max(1, el.size)}px ${f.css}`;
}

export function textLines(el: TextEl) {
  return (el.text || ' ').split('\n');
}

/** Text box size; estimated without a canvas (tests). */
export function textSize(el: TextEl): { w: number; h: number } {
  const lines = textLines(el);
  const ctx = measurer();
  let w = 0;
  if (ctx) {
    ctx.font = fontFor(el);
    for (const l of lines) w = Math.max(w, ctx.measureText(l).width);
  } else {
    for (const l of lines) w = Math.max(w, l.length * el.size * 0.55);
  }
  return { w, h: lines.length * el.size * 1.2 };
}

export function bounds(el: MarkupEl): Box {
  const pad = el.style.width / 2;
  switch (el.kind) {
    case 'pen':
    case 'highlight': {
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (let i = 0; i < el.points.length; i += 3) {
        const x = el.points[i];
        const y = el.points[i + 1];
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
      if (!Number.isFinite(x0)) return { x: 0, y: 0, w: 0, h: 0 };
      return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
    }
    case 'line':
    case 'arrow': {
      const head = el.kind === 'arrow' ? arrowHead(el.style.width) : 0;
      const p = pad + head;
      return {
        x: Math.min(el.x1, el.x2) - p,
        y: Math.min(el.y1, el.y2) - p,
        w: Math.abs(el.x2 - el.x1) + p * 2,
        h: Math.abs(el.y2 - el.y1) + p * 2,
      };
    }
    case 'rect':
    case 'ellipse':
      return { x: el.x - pad, y: el.y - pad, w: el.w + pad * 2, h: el.h + pad * 2 };
    case 'text': {
      const s = textSize(el);
      return { x: el.x, y: el.y, w: s.w, h: s.h };
    }
  }
}

export function unionBounds(els: MarkupEl[]): Box | null {
  if (!els.length) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const el of els) {
    const b = bounds(el);
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

const intersects = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

export function hitTest(el: MarkupEl, px: number, py: number, tol: number): boolean {
  const reach = el.style.width / 2 + tol;
  switch (el.kind) {
    case 'pen':
    case 'highlight': {
      const p = el.points;
      if (p.length < 6) return p.length >= 2 && Math.hypot(px - p[0], py - p[1]) <= reach;
      for (let i = 3; i < p.length; i += 3) if (distanceToSegment(px, py, p[i - 3], p[i - 2], p[i], p[i + 1]) <= reach) return true;
      return false;
    }
    case 'line':
    case 'arrow':
      return distanceToSegment(px, py, el.x1, el.y1, el.x2, el.y2) <= reach;
    case 'rect': {
      const inside = px >= el.x - reach && px <= el.x + el.w + reach && py >= el.y - reach && py <= el.y + el.h + reach;
      const deep = px > el.x + reach && px < el.x + el.w - reach && py > el.y + reach && py < el.y + el.h - reach;
      return inside && !deep;
    }
    case 'ellipse': {
      const rx = el.w / 2;
      const ry = el.h / 2;
      if (rx <= 0 || ry <= 0) return false;
      const cx = el.x + rx;
      const cy = el.y + ry;
      const d = Math.hypot((px - cx) / rx, (py - cy) / ry);
      return Math.abs(d - 1) * Math.min(rx, ry) <= reach;
    }
    case 'text': {
      const b = bounds(el);
      return px >= b.x - tol && px <= b.x + b.w + tol && py >= b.y - tol && py <= b.y + b.h + tol;
    }
  }
}

/** Topmost element under a point. */
export function elementAt(els: MarkupEl[], px: number, py: number, tol: number): MarkupEl | null {
  for (let i = els.length - 1; i >= 0; i--) if (hitTest(els[i], px, py, tol)) return els[i];
  return null;
}

// ---------- transforms ----------

/** Affine matrix [a, b, c, d, e, f]: x' = a x + c y + e, y' = b x + d y + f. */
export type Matrix = [number, number, number, number, number, number];

export const translate = (dx: number, dy: number): Matrix => [1, 0, 0, 1, dx, dy];
export const scale = (sx: number, sy: number): Matrix => [sx, 0, 0, sy, 0, 0];
/** Rotate a w x h image 90 degrees clockwise: (x, y) -> (h - y, x). */
export const rotateCW = (h: number): Matrix => [0, 1, -1, 0, h, 0];
/** Rotate a w x h image 90 degrees anticlockwise: (x, y) -> (y, w - x). */
export const rotateCCW = (w: number): Matrix => [0, -1, 1, 0, 0, w];
export const flipH = (w: number): Matrix => [-1, 0, 0, 1, w, 0];
export const flipV = (h: number): Matrix => [1, 0, 0, -1, 0, h];

const apply = (m: Matrix, x: number, y: number) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]] as const;
const lengthScale = (m: Matrix) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));

/** The element after the image underneath was cropped, scaled, rotated or flipped. */
export function transformEl(el: MarkupEl, m: Matrix): MarkupEl {
  const k = lengthScale(m);
  const style = { ...el.style, width: el.style.width * k };
  switch (el.kind) {
    case 'pen':
    case 'highlight': {
      const pts = el.points.slice();
      for (let i = 0; i < pts.length; i += 3) {
        const [x, y] = apply(m, pts[i], pts[i + 1]);
        pts[i] = x;
        pts[i + 1] = y;
      }
      return { ...el, style, points: pts };
    }
    case 'line':
    case 'arrow': {
      const [x1, y1] = apply(m, el.x1, el.y1);
      const [x2, y2] = apply(m, el.x2, el.y2);
      return { ...el, style, x1, y1, x2, y2 };
    }
    case 'rect':
    case 'ellipse': {
      const [ax, ay] = apply(m, el.x, el.y);
      const [bx, by] = apply(m, el.x + el.w, el.y + el.h);
      return { ...el, style, x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) };
    }
    case 'text': {
      // Text stays upright; its box moves with the photo.
      const s = textSize(el);
      const [cx, cy] = apply(m, el.x + s.w / 2, el.y + s.h / 2);
      const size = el.size * k;
      const ns = textSize({ ...el, size });
      return { ...el, style, size, x: cx - ns.w / 2, y: cy - ns.h / 2 };
    }
  }
}

export const transformAll = (els: MarkupEl[], m: Matrix) => els.map((e) => transformEl(e, m));

export function moveEl(el: MarkupEl, dx: number, dy: number): MarkupEl {
  return transformEl(el, translate(dx, dy));
}

// ---------- eraser ----------

/**
 * Rubs out markup along a path. Pen and highlighter strokes are cut where the eraser passes
 * and the rest stays; shapes, lines and text are removed when touched.
 */
export function erase(els: MarkupEl[], fx: number, fy: number, tx: number, ty: number, radius: number): MarkupEl[] {
  const reach: Box = { x: Math.min(fx, tx) - radius, y: Math.min(fy, ty) - radius, w: Math.abs(tx - fx) + radius * 2, h: Math.abs(ty - fy) + radius * 2 };
  let changed = false;
  const out: MarkupEl[] = [];
  for (const el of els) {
    if (!intersects(bounds(el), reach)) {
      out.push(el);
    } else if (el.kind === 'pen' || el.kind === 'highlight') {
      const pieces = cut(el, fx, fy, tx, ty, radius);
      if (pieces.length !== 1 || pieces[0] !== el) changed = true;
      out.push(...pieces);
    } else if (touches(el, fx, fy, tx, ty, radius)) {
      changed = true;
    } else {
      out.push(el);
    }
  }
  return changed ? out : els;
}

function touches(el: MarkupEl, fx: number, fy: number, tx: number, ty: number, radius: number) {
  const steps = Math.max(1, Math.ceil(Math.hypot(tx - fx, ty - fy) / Math.max(radius / 2, 1)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (hitTest(el, fx + (tx - fx) * t, fy + (ty - fy) * t, radius)) return true;
  }
  return false;
}

function cut(stroke: StrokeEl, fx: number, fy: number, tx: number, ty: number, radius: number): MarkupEl[] {
  const reach = radius + stroke.style.width / 2;
  const pts = densify(stroke.points, Math.max(radius / 2, 1));
  const pieces: StrokeEl[] = [];
  let run: number[] = [];
  let wasCut = false;
  for (let i = 0; i < pts.length; i += 3) {
    if (distanceToSegment(pts[i], pts[i + 1], fx, fy, tx, ty) <= reach) {
      wasCut = true;
      if (run.length >= 3) pieces.push({ ...stroke, id: newId(), points: run });
      run = [];
    } else {
      run.push(pts[i], pts[i + 1], pts[i + 2]);
    }
  }
  if (!wasCut) return [stroke];
  if (run.length >= 3) pieces.push({ ...stroke, id: newId(), points: run });
  return pieces;
}

function densify(p: number[], step: number): number[] {
  if (p.length < 6) return p;
  const out: number[] = [p[0], p[1], p[2]];
  for (let i = 3; i < p.length; i += 3) {
    const [x0, y0, p0] = [p[i - 3], p[i - 2], p[i - 1]];
    const [x1, y1, p1] = [p[i], p[i + 1], p[i + 2]];
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      out.push(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, p0 + (p1 - p0) * t);
    }
  }
  return out;
}

// ---------- drawing ----------

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export const arrowHead = (width: number) => Math.max(10, width * 3.2);

function strokePath(ctx: Ctx, p: number[]) {
  ctx.beginPath();
  ctx.moveTo(p[0], p[1]);
  if (p.length === 3) {
    ctx.lineTo(p[0] + 0.01, p[1]);
    return;
  }
  // Smooth through midpoints.
  for (let i = 3; i < p.length - 3; i += 3) {
    const mx = (p[i] + p[i + 3]) / 2;
    const my = (p[i + 1] + p[i + 4]) / 2;
    ctx.quadraticCurveTo(p[i], p[i + 1], mx, my);
  }
  ctx.lineTo(p[p.length - 3], p[p.length - 2]);
}

function variesPressure(p: number[]) {
  const first = p[2];
  for (let i = 5; i < p.length; i += 3) if (Math.abs(p[i] - first) > 0.05) return true;
  return false;
}

export function drawElement(ctx: Ctx, el: MarkupEl) {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = el.style.color;
  ctx.fillStyle = el.style.color;
  ctx.lineWidth = el.style.width;
  switch (el.kind) {
    case 'pen': {
      const p = el.points;
      if (p.length >= 6 && variesPressure(p)) {
        // Pencil pressure: each segment gets its own width.
        for (let i = 3; i < p.length; i += 3) {
          ctx.lineWidth = el.style.width * (0.35 + 0.9 * ((p[i - 1] + p[i + 2]) / 2));
          ctx.beginPath();
          ctx.moveTo(p[i - 3], p[i - 2]);
          ctx.lineTo(p[i], p[i + 1]);
          ctx.stroke();
        }
      } else if (p.length >= 3) {
        strokePath(ctx, p);
        ctx.stroke();
      }
      break;
    }
    case 'highlight': {
      ctx.globalAlpha = 0.38;
      ctx.lineCap = 'butt';
      if (el.points.length >= 3) {
        strokePath(ctx, el.points);
        ctx.stroke();
      }
      break;
    }
    case 'line':
    case 'arrow': {
      const { x1, y1, x2, y2 } = el;
      const len = Math.hypot(x2 - x1, y2 - y1);
      let ex = x2;
      let ey = y2;
      if (el.kind === 'arrow' && len > 0) {
        const head = arrowHead(el.style.width);
        const ang = Math.atan2(y2 - y1, x2 - x1);
        const half = Math.PI / 7;
        const base = head * Math.cos(half);
        if (len > base) {
          ex = x2 - base * Math.cos(ang);
          ey = y2 - base * Math.sin(ang);
        }
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - head * Math.cos(ang - half), y2 - head * Math.sin(ang - half));
        ctx.lineTo(x2 - head * Math.cos(ang + half), y2 - head * Math.sin(ang + half));
        ctx.closePath();
        ctx.lineWidth = Math.max(1, el.style.width * 0.5);
        ctx.fill();
        ctx.stroke();
        ctx.lineWidth = el.style.width;
      }
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      break;
    }
    case 'rect':
      ctx.strokeRect(el.x, el.y, el.w, el.h);
      break;
    case 'ellipse':
      ctx.beginPath();
      ctx.ellipse(el.x + el.w / 2, el.y + el.h / 2, Math.max(0.1, el.w / 2), Math.max(0.1, el.h / 2), 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 'text': {
      ctx.font = fontFor(el);
      ctx.textBaseline = 'top';
      const lines = textLines(el);
      lines.forEach((l, i) => ctx.fillText(l, el.x, el.y + i * el.size * 1.2 + el.size * 0.08));
      break;
    }
  }
  ctx.restore();
}

export function drawAll(ctx: Ctx, els: MarkupEl[]) {
  for (const el of els) drawElement(ctx, el);
}
