import { describe, expect, it } from 'vitest';
import { boxBlur, encodeToTarget, flattenOnWhite, pixelate, resizePixels, type Pixels } from '../../src/engine/ops';

function solid(w: number, h: number, rgba: [number, number, number, number]): Pixels {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
  return { data, width: w, height: h };
}

/** A pretend encoder: size grows with quality and pixel count. */
const fake = async (p: Pixels, q: number) => new Uint8Array(Math.round(p.width * p.height * (0.02 + q / 100)));

describe('target file size', () => {
  it('finds the highest quality that fits', async () => {
    const p = solid(100, 100, [1, 2, 3, 255]);
    const r = await encodeToTarget(p, 'jpeg', 7000, fake);
    expect(r.met).toBe(true);
    expect(r.bytes.length).toBeLessThanOrEqual(7000);
    expect(r.quality).toBeGreaterThanOrEqual(60);
    expect(r.width).toBe(100);
  });

  it('scales down when even the lowest quality is too big', async () => {
    const p = solid(200, 200, [1, 2, 3, 255]);
    const r = await encodeToTarget(p, 'jpeg', 2000, fake);
    expect(r.met).toBe(true);
    expect(r.width).toBeLessThan(200);
    expect(r.width / r.height).toBeCloseTo(1, 2);
  });

  it('PNG shrinks by size only', async () => {
    const r = await encodeToTarget(solid(200, 100, [0, 0, 0, 255]), 'png', 5000, fake);
    expect(r.met).toBe(true);
    expect(r.quality).toBe(100);
    expect(r.width).toBeLessThan(200);
  });

  it('returns the smallest attempt if nothing ever fits', async () => {
    const r = await encodeToTarget(solid(64, 64, [0, 0, 0, 255]), 'jpeg', 1, fake);
    expect(r.met).toBe(false);
    expect(r.bytes.length).toBeGreaterThan(1);
  });
});

describe('pixel ops', () => {
  it('blur leaves a flat colour flat', () => {
    const out = boxBlur(solid(20, 10, [100, 150, 200, 255]), 3);
    for (let i = 0; i < out.data.length; i += 4) expect([...out.data.subarray(i, i + 4)]).toEqual([100, 150, 200, 255]);
  });

  it('pixelate averages blocks', () => {
    const p = solid(4, 2, [0, 0, 0, 255]);
    p.data.set([200, 200, 200, 255], 0);
    const out = pixelate(p, 2);
    expect(out.data[0]).toBe(50);
    expect(out.data[4]).toBe(50);
    expect(out.data[8]).toBe(0);
  });

  it('resizes to the exact size, keeping colour', () => {
    const out = resizePixels(solid(30, 20, [10, 20, 30, 255]), 7, 5);
    expect(out.width).toBe(7);
    expect(out.height).toBe(5);
    expect([...out.data.subarray(0, 4)]).toEqual([10, 20, 30, 255]);
    const up = resizePixels(solid(2, 2, [10, 20, 30, 255]), 5, 5);
    expect(up.width).toBe(5);
  });

  it('JPEG flattening turns transparent pixels white', () => {
    const out = flattenOnWhite(solid(1, 1, [0, 0, 0, 0]));
    expect([...out.data]).toEqual([255, 255, 255, 255]);
  });
});
