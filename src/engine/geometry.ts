/**
 * Crop, resize and physical-size maths. Ported from PicKit for Windows
 * (Imaging/CropGeometry.cs, ResizeCalculator.cs, PhysicalSize.cs). All in image pixels.
 */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type CropHandle = 'none' | 'move' | 'tl' | 't' | 'tr' | 'r' | 'br' | 'b' | 'bl' | 'l';

const MIN_SIDE = 1;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The largest centred box of the given shape. */
export function centredCrop(sw: number, sh: number, tw: number, th: number): Rect {
  const target = tw / th;
  const source = sw / sh;
  let w: number;
  let h: number;
  if (source > target) {
    h = sh;
    w = clamp(Math.round(sh * target), 1, sw);
  } else {
    w = sw;
    h = clamp(Math.round(sw / target), 1, sh);
  }
  return { x: Math.floor((sw - w) / 2), y: Math.floor((sh - h) / 2), w, h };
}

export function initialCrop(w: number, h: number, aspect?: number): Rect {
  if (!aspect) return { x: 0, y: 0, w, h };
  return centredCrop(w, h, Math.round(aspect * 10_000), 10_000);
}

/** Reshapes a box to an aspect ratio around its centre, staying inside the image. */
export function withAspect(box: Rect, aspect: number, w: number, h: number): Rect {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  let bw = box.w;
  let bh = bw / aspect;
  if (bh > box.h) {
    bh = box.h;
    bw = bh * aspect;
  }
  // Grow back towards the largest fit if the old box was small in the other direction.
  if (bw > w) {
    bw = w;
    bh = bw / aspect;
  }
  if (bh > h) {
    bh = h;
    bw = bh * aspect;
  }
  const x = clamp(cx - bw / 2, 0, Math.max(0, w - bw));
  const y = clamp(cy - bh / 2, 0, Math.max(0, h - bh));
  return { x, y, w: bw, h: bh };
}

export function dragCrop(start: Rect, handle: CropHandle, dx: number, dy: number, aspect: number | undefined, w: number, h: number): Rect {
  if (handle === 'none') return start;
  if (handle === 'move') {
    return { x: clamp(start.x + dx, 0, w - start.w), y: clamp(start.y + dy, 0, h - start.h), w: start.w, h: start.h };
  }
  return aspect ? dragLocked(start, handle, dx, dy, aspect, w, h) : dragFree(start, handle, dx, dy, w, h);
}

function dragFree(s: Rect, handle: CropHandle, dx: number, dy: number, w: number, h: number): Rect {
  let left = s.x;
  let top = s.y;
  let right = s.x + s.w;
  let bottom = s.y + s.h;
  if (handle === 'l' || handle === 'tl' || handle === 'bl') left = clamp(s.x + dx, 0, right - MIN_SIDE);
  if (handle === 'r' || handle === 'tr' || handle === 'br') right = clamp(s.x + s.w + dx, left + MIN_SIDE, w);
  if (handle === 't' || handle === 'tl' || handle === 'tr') top = clamp(s.y + dy, 0, bottom - MIN_SIDE);
  if (handle === 'b' || handle === 'bl' || handle === 'br') bottom = clamp(s.y + s.h + dy, top + MIN_SIDE, h);
  return { x: left, y: top, w: right - left, h: bottom - top };
}

function anchorFor(b: Rect, handle: CropHandle) {
  const r = b.x + b.w;
  const btm = b.y + b.h;
  const mx = b.x + b.w / 2;
  const my = b.y + b.h / 2;
  switch (handle) {
    case 'tl': return { x: r, y: btm };
    case 'tr': return { x: b.x, y: btm };
    case 'bl': return { x: r, y: b.y };
    case 'br': return { x: b.x, y: b.y };
    case 'l': return { x: r, y: my };
    case 'r': return { x: b.x, y: my };
    case 't': return { x: mx, y: btm };
    case 'b': return { x: mx, y: b.y };
    default: return { x: mx, y: my };
  }
}

function dragLocked(s: Rect, handle: CropHandle, dx: number, dy: number, aspect: number, w: number, h: number): Rect {
  // Edges grow symmetrically around the opposite edge's centre; corners pivot on the opposite corner.
  const anchor = anchorFor(s, handle);
  const growsLeft = handle === 'tl' || handle === 'bl' || handle === 'l';
  const growsUp = handle === 'tl' || handle === 'tr' || handle === 't';
  const side = handle === 'l' || handle === 'r';
  const topEdge = handle === 't' || handle === 'b';

  const fromWidth = s.w + (growsLeft ? -dx : dx);
  const fromHeight = (s.h + (growsUp ? -dy : dy)) * aspect;
  const wanted = side ? fromWidth : topEdge ? fromHeight : Math.max(fromWidth, fromHeight);

  const roomX = topEdge ? 2 * Math.min(anchor.x, w - anchor.x) : growsLeft ? anchor.x : w - anchor.x;
  const roomY = side ? 2 * Math.min(anchor.y, h - anchor.y) : growsUp ? anchor.y : h - anchor.y;

  const bw = Math.max(Math.min(wanted, Math.min(roomX, roomY * aspect)), Math.max(MIN_SIDE, MIN_SIDE * aspect));
  const bh = bw / aspect;
  const x = topEdge ? anchor.x - bw / 2 : growsLeft ? anchor.x - bw : anchor.x;
  const y = side ? anchor.y - bh / 2 : growsUp ? anchor.y - bh : anchor.y;
  return { x, y, w: bw, h: bh };
}

/** Pulls free-crop edges onto the image's edges when they come within `tol` pixels. */
export function snapToEdges(b: Rect, w: number, h: number, tol: number): Rect {
  let left = b.x;
  let top = b.y;
  let right = b.x + b.w;
  let bottom = b.y + b.h;
  if (Math.abs(left) <= tol) left = 0;
  if (Math.abs(top) <= tol) top = 0;
  if (Math.abs(w - right) <= tol) right = w;
  if (Math.abs(h - bottom) <= tol) bottom = h;
  return { x: left, y: top, w: Math.max(MIN_SIDE, right - left), h: Math.max(MIN_SIDE, bottom - top) };
}

export function hitTestCrop(b: Rect, px: number, py: number, tol: number): CropHandle {
  const nl = Math.abs(px - b.x) <= tol;
  const nr = Math.abs(px - (b.x + b.w)) <= tol;
  const nt = Math.abs(py - b.y) <= tol;
  const nb = Math.abs(py - (b.y + b.h)) <= tol;
  const inX = px >= b.x - tol && px <= b.x + b.w + tol;
  const inY = py >= b.y - tol && py <= b.y + b.h + tol;
  if (nl && nt) return 'tl';
  if (nr && nt) return 'tr';
  if (nl && nb) return 'bl';
  if (nr && nb) return 'br';
  if (nl && inY) return 'l';
  if (nr && inY) return 'r';
  if (nt && inX) return 't';
  if (nb && inX) return 'b';
  return px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h ? 'move' : 'none';
}

/** Whole-pixel rectangle inside the image, at least 1 x 1. */
export function toPixels(b: Rect, w: number, h: number): Rect {
  const left = clamp(Math.round(b.x), 0, w - 1);
  const top = clamp(Math.round(b.y), 0, h - 1);
  const right = clamp(Math.round(b.x + b.w), left + 1, w);
  const bottom = clamp(Math.round(b.y + b.h), top + 1, h);
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/** How much a crop removes from each side, as fractions of the image. */
export function cropAmounts(w: number, h: number, b: Rect) {
  return { left: b.x / w, top: b.y / h, right: (w - b.x - b.w) / w, bottom: (h - b.y - b.h) / h };
}

// ---------- resize ----------

export const heightForWidth = (sw: number, sh: number, width: number) => Math.max(1, Math.round((width * sh) / sw));
export const widthForHeight = (sw: number, sh: number, height: number) => Math.max(1, Math.round((height * sw) / sh));

/** Shrinks to fit inside a box; never enlarges. */
export function planFit(sw: number, sh: number, tw: number, th: number): { w: number; h: number } {
  const ratio = Math.min(tw / sw, th / sh);
  if (ratio >= 1) return { w: sw, h: sh };
  return { w: clamp(Math.round(sw * ratio), 1, tw), h: clamp(Math.round(sh * ratio), 1, th) };
}

export function isStretched(sw: number, sh: number, w: number, h: number): boolean {
  const sr = sw / sh;
  const tr = w / h;
  return Math.abs(heightForWidth(sw, sh, w) - h) > 1 && Math.abs(sr - tr) / sr > 0.01;
}

// ---------- physical size ----------

export type SizeUnit = 'px' | 'mm' | 'cm';
export const DEFAULT_DPI = 300;
export const MAX_DPI = 9600;
const MM_PER_INCH = 25.4;

export const isValidDpi = (dpi: number) => Number.isInteger(dpi) && dpi >= 1 && dpi <= MAX_DPI;

export function fromPixels(px: number, unit: SizeUnit, dpi: number): number {
  if (unit === 'mm') return (px * MM_PER_INCH) / dpi;
  if (unit === 'cm') return (px * MM_PER_INCH) / dpi / 10;
  return px;
}

export function toPixelsFrom(value: number, unit: SizeUnit, dpi: number): number {
  const px = unit === 'mm' ? (value * dpi) / MM_PER_INCH : unit === 'cm' ? (value * 10 * dpi) / MM_PER_INCH : value;
  return Math.max(0, Math.round(px));
}

export function formatPhysical(value: number, unit: SizeUnit): string {
  const digits = unit === 'px' ? 0 : unit === 'mm' ? 2 : 3;
  const s = value.toFixed(digits);
  return unit === 'px' ? s : s.replace(/\.?0+$/, '');
}

export function parseNumber(text: string): number | null {
  const v = Number(text.trim().replace(',', '.'));
  return Number.isFinite(v) ? v : null;
}

// ---------- straighten ----------

/**
 * Straightening rotates the photo and keeps the largest centred rectangle of the original
 * shape that has no empty corners. Returns that rectangle's scale relative to the original.
 */
export function straightenScale(w: number, h: number, radians: number): number {
  const c = Math.abs(Math.cos(radians));
  const s = Math.abs(Math.sin(radians));
  return Math.min(w / (w * c + h * s), h / (w * s + h * c));
}
