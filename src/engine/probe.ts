import { isIOS } from '../app/env';

/**
 * How big a canvas this browser will really draw. iOS has historically capped a canvas at
 * about 16.7 MP and silently renders anything bigger as blank, so we test rather than trust.
 * Each candidate is drawn into and read back; the first that round-trips wins.
 */
const CANDIDATES: [number, number][] = [
  [8192, 6144], // 50 MP
  [6144, 6144], // 37.7 MP
  [5120, 5120], // 26.2 MP
  [4096, 4096], // 16.7 MP
  [3072, 3072], // 9.4 MP
  [2048, 2048],
];

/** The working copy stays under this on iPhone even if a bigger canvas works, leaving room for undo. */
const IOS_BUDGET = 4096 * 4096;
const DESKTOP_BUDGET = 8192 * 6144;

let cached: { canvasLimit: number; budget: number } | null = null;

function works(w: number, h: number): boolean {
  const c = document.createElement('canvas');
  try {
    c.width = w;
    c.height = h;
    const x = c.getContext('2d');
    if (!x) return false;
    x.fillStyle = '#ff0000';
    x.fillRect(w - 1, h - 1, 1, 1);
    const d = x.getImageData(w - 1, h - 1, 1, 1).data;
    return d[0] === 255 && d[3] === 255;
  } catch {
    return false;
  } finally {
    c.width = 0;
    c.height = 0;
  }
}

export function canvasBudget(): { canvasLimit: number; budget: number } {
  if (cached) return cached;
  const cap = isIOS() ? IOS_BUDGET : DESKTOP_BUDGET;
  let limit = 2048 * 2048;
  for (const [w, h] of CANDIDATES) {
    if (w * h > cap) continue; // no need to allocate more than we'd ever use
    if (works(w, h)) {
      limit = w * h;
      break;
    }
  }
  cached = { canvasLimit: limit, budget: Math.min(limit, cap) };
  return cached;
}
