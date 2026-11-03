import type { Pixels } from './ops';
import type { Rect } from './geometry';

/**
 * Canvas helpers for the working copy. Every canvas made here is released explicitly
 * (width = 0) when done: iOS counts canvas memory across the whole page and kills the tab when
 * it runs out, long before garbage collection would get round to it.
 */
export function createCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export function freeCanvas(c: HTMLCanvasElement | null | undefined) {
  if (c) {
    c.width = 0;
    c.height = 0;
  }
}

export const ctx2d = (c: HTMLCanvasElement) => c.getContext('2d', { willReadFrequently: false })!;

export function readPixels(c: HTMLCanvasElement, r?: Rect): Pixels {
  const x = r ? Math.round(r.x) : 0;
  const y = r ? Math.round(r.y) : 0;
  const w = r ? Math.max(1, Math.round(r.w)) : c.width;
  const h = r ? Math.max(1, Math.round(r.h)) : c.height;
  const d = ctx2d(c).getImageData(x, y, w, h);
  return { data: d.data, width: d.width, height: d.height };
}

export function writePixels(c: HTMLCanvasElement, p: Pixels, x = 0, y = 0) {
  ctx2d(c).putImageData(new ImageData(p.data as Uint8ClampedArray<ArrayBuffer>, p.width, p.height), Math.round(x), Math.round(y));
}

export function canvasFromPixels(p: Pixels): HTMLCanvasElement {
  const c = createCanvas(p.width, p.height);
  writePixels(c, p);
  return c;
}

export function canvasFromSource(src: CanvasImageSource, w: number, h: number): HTMLCanvasElement {
  const c = createCanvas(w, h);
  const x = ctx2d(c);
  x.imageSmoothingQuality = 'high';
  x.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

export function cropCanvas(c: HTMLCanvasElement, r: Rect): HTMLCanvasElement {
  const out = createCanvas(r.w, r.h);
  ctx2d(out).drawImage(c, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
  return out;
}

/** High-quality resize: halves in steps when shrinking a lot, then lands on the exact size. */
export function resizeCanvas(c: HTMLCanvasElement, w: number, h: number): HTMLCanvasElement {
  w = Math.max(1, Math.round(w));
  h = Math.max(1, Math.round(h));
  let cur = c;
  const temps: HTMLCanvasElement[] = [];
  while (cur.width / 2 >= w && cur.height / 2 >= h) {
    const half = createCanvas(Math.floor(cur.width / 2), Math.floor(cur.height / 2));
    const x = ctx2d(half);
    x.imageSmoothingQuality = 'high';
    x.drawImage(cur, 0, 0, half.width, half.height);
    temps.push(half);
    cur = half;
  }
  const out = createCanvas(w, h);
  const x = ctx2d(out);
  x.imageSmoothingQuality = 'high';
  x.drawImage(cur, 0, 0, w, h);
  temps.forEach(freeCanvas);
  return out;
}

export function rotateCanvas90(c: HTMLCanvasElement, clockwise: boolean): HTMLCanvasElement {
  const out = createCanvas(c.height, c.width);
  const x = ctx2d(out);
  if (clockwise) {
    x.translate(out.width, 0);
    x.rotate(Math.PI / 2);
  } else {
    x.translate(0, out.height);
    x.rotate(-Math.PI / 2);
  }
  x.drawImage(c, 0, 0);
  return out;
}

export function flipCanvas(c: HTMLCanvasElement, horizontal: boolean): HTMLCanvasElement {
  const out = createCanvas(c.width, c.height);
  const x = ctx2d(out);
  if (horizontal) {
    x.translate(out.width, 0);
    x.scale(-1, 1);
  } else {
    x.translate(0, out.height);
    x.scale(1, -1);
  }
  x.drawImage(c, 0, 0);
  return out;
}

/** Rotates by `radians` and keeps the largest centred rectangle of the same shape. */
export function straightenCanvas(c: HTMLCanvasElement, radians: number, k: number): HTMLCanvasElement {
  const out = createCanvas(c.width * k, c.height * k);
  const x = ctx2d(out);
  x.imageSmoothingQuality = 'high';
  x.translate(out.width / 2, out.height / 2);
  x.rotate(radians);
  x.drawImage(c, -c.width / 2, -c.height / 2);
  return out;
}

export function canvasToBlob(c: HTMLCanvasElement, type = 'image/png', quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Encoding failed'))), type, quality));
}

/** A small preview, for the photo switcher, Resume card and Batch. */
export function thumbnail(src: CanvasImageSource & { width: number; height: number }, max = 240): HTMLCanvasElement {
  const k = Math.min(1, max / Math.max(src.width, src.height));
  return canvasFromSource(src, Math.max(1, src.width * k), Math.max(1, src.height * k));
}
