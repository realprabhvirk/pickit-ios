import { describe, expect, it } from 'vitest';
import {
  centredCrop,
  cropAmounts,
  dragCrop,
  fromPixels,
  hitTestCrop,
  initialCrop,
  isStretched,
  planFit,
  snapToEdges,
  straightenScale,
  toPixels,
  toPixelsFrom,
  withAspect,
} from '../../src/engine/geometry';

// Mirrors CropTests and ResizeTests from PicKit for Windows.
describe('crop geometry', () => {
  it('starts with the largest centred box of the chosen shape', () => {
    expect(initialCrop(4000, 3000)).toEqual({ x: 0, y: 0, w: 4000, h: 3000 });
    const sq = initialCrop(4000, 3000, 1);
    expect(sq.w).toBe(3000);
    expect(sq.h).toBe(3000);
    expect(sq.x).toBe(500);
  });

  it('free drags clamp to the image and never invert', () => {
    const r = dragCrop({ x: 100, y: 100, w: 200, h: 200 }, 'tl', -500, -500, undefined, 1000, 1000);
    expect(r).toEqual({ x: 0, y: 0, w: 300, h: 300 });
    const inv = dragCrop({ x: 100, y: 100, w: 200, h: 200 }, 'l', 900, 0, undefined, 1000, 1000);
    expect(inv.w).toBeGreaterThanOrEqual(1);
  });

  it('moving keeps the size and stays inside', () => {
    const r = dragCrop({ x: 100, y: 100, w: 200, h: 200 }, 'move', 5000, -5000, undefined, 1000, 800);
    expect(r).toEqual({ x: 800, y: 0, w: 200, h: 200 });
  });

  it('locked drags keep the aspect ratio and stay inside', () => {
    for (const h of ['tl', 't', 'tr', 'r', 'br', 'b', 'bl', 'l'] as const) {
      const r = dragCrop({ x: 300, y: 300, w: 400, h: 300 }, h, 900, 700, 4 / 3, 1600, 1200);
      expect(r.w / r.h).toBeCloseTo(4 / 3, 3);
      expect(r.x).toBeGreaterThanOrEqual(-0.001);
      expect(r.y).toBeGreaterThanOrEqual(-0.001);
      expect(r.x + r.w).toBeLessThanOrEqual(1600.001);
      expect(r.y + r.h).toBeLessThanOrEqual(1200.001);
    }
  });

  it('withAspect reshapes around the centre', () => {
    const r = withAspect({ x: 0, y: 0, w: 1000, h: 1000 }, 16 / 9, 1000, 1000);
    expect(r.w / r.h).toBeCloseTo(16 / 9, 3);
    expect(r.y + r.h / 2).toBeCloseTo(500, 3);
  });

  it('snaps free edges onto the photo edges', () => {
    expect(snapToEdges({ x: 4, y: 3, w: 990, h: 992 }, 1000, 1000, 8)).toEqual({ x: 0, y: 0, w: 1000, h: 1000 });
  });

  it('finds handles, preferring corners', () => {
    const b = { x: 100, y: 100, w: 400, h: 300 };
    expect(hitTestCrop(b, 102, 98, 22)).toBe('tl');
    expect(hitTestCrop(b, 300, 101, 22)).toBe('t');
    expect(hitTestCrop(b, 300, 250, 22)).toBe('move');
    expect(hitTestCrop(b, 900, 900, 22)).toBe('none');
  });

  it('rounds to whole pixels, at least 1 x 1, inside the image', () => {
    expect(toPixels({ x: -5, y: 0.4, w: 0.1, h: 0.1 }, 10, 10)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it('describes what is cut', () => {
    const a = cropAmounts(1000, 1000, centredCrop(1000, 1000, 4, 5));
    expect(a.left).toBeCloseTo(0.1, 2);
    expect(a.top).toBe(0);
  });
});

describe('resize maths', () => {
  it('fit never enlarges', () => {
    expect(planFit(800, 600, 1920, 1080)).toEqual({ w: 800, h: 600 });
    expect(planFit(4000, 3000, 1920, 1080)).toEqual({ w: 1440, h: 1080 });
  });

  it('flags stretching, ignoring rounding on small images', () => {
    expect(isStretched(4000, 3000, 400, 300)).toBe(false);
    expect(isStretched(4000, 3000, 400, 400)).toBe(true);
    expect(isStretched(3, 2, 2, 1)).toBe(false);
  });

  it('converts millimetres and centimetres at a DPI and back', () => {
    expect(fromPixels(300, 'mm', 300)).toBeCloseTo(25.4, 6);
    expect(fromPixels(300, 'cm', 300)).toBeCloseTo(2.54, 6);
    expect(toPixelsFrom(25.4, 'mm', 300)).toBe(300);
    expect(toPixelsFrom(2.54, 'cm', 300)).toBe(300);
    for (const px of [1, 99, 1234, 6000]) expect(toPixelsFrom(fromPixels(px, 'mm', 72), 'mm', 72)).toBe(px);
  });

  it('straightening keeps less as the angle grows', () => {
    expect(straightenScale(4000, 3000, 0)).toBeCloseTo(1, 6);
    const a = straightenScale(4000, 3000, 0.05);
    const b = straightenScale(4000, 3000, 0.3);
    expect(a).toBeLessThan(1);
    expect(b).toBeLessThan(a);
  });
});
