import { describe, expect, it } from 'vitest';
import { ViewTransform } from '../../src/engine/viewTransform';

// Mirrors tests/PicKit.Tests/ViewTransformTests.cs from PicKit for Windows, plus insets.
function create(iw = 4000, ih = 3000, vw = 393, vh = 852, dpr = 3) {
  const v = new ViewTransform();
  v.dpr = dpr;
  v.setViewport(vw, vh);
  v.setImage(iw, ih, true);
  return v;
}

describe('ViewTransform', () => {
  it.each([
    [0, 0],
    [4000, 3000],
    [1234.5, 987.25],
  ])('image to view and back is lossless (%f, %f)', (x, y) => {
    const v = create();
    v.zoomAt(300, 200, 0.7);
    const p = v.imageToView(x, y);
    const back = v.viewToImage(p.x, p.y);
    expect(back.x).toBeCloseTo(x, 2);
    expect(back.y).toBeCloseTo(y, 2);
  });

  it('keeps the point under the fingers still while zooming', () => {
    const v = create();
    v.zoomAt(196, 426, v.fitZoom * 2);
    const anchor = { x: 180, y: 400 };
    const under = v.viewToImage(anchor.x, anchor.y);
    v.zoomAt(anchor.x, anchor.y, v.zoom * 1.8);
    const after = v.viewToImage(anchor.x, anchor.y);
    expect(after.x).toBeCloseTo(under.x, 0);
    expect(after.y).toBeCloseTo(under.y, 0);
  });

  it('fits the whole image inside the uncovered area', () => {
    const v = create();
    v.setInsets({ top: 115, bottom: 110, left: 0, right: 0 });
    const tl = v.imageToView(0, 0);
    const br = v.imageToView(4000, 3000);
    expect(tl.x).toBeGreaterThanOrEqual(-0.01);
    expect(tl.y).toBeGreaterThanOrEqual(115 - 0.01);
    expect(br.x).toBeLessThanOrEqual(393 + 0.01);
    expect(br.y).toBeLessThanOrEqual(852 - 110 + 0.01);
  });

  it('centres an image that fits, even after panning', () => {
    const v = create(1000, 1000);
    v.panBy(500, -300);
    const tl = v.imageToView(0, 0);
    const br = v.imageToView(1000, 1000);
    expect(tl.x).toBeCloseTo(393 - br.x, 3);
    expect(tl.y - 0).toBeCloseTo(852 - br.y, 3);
  });

  it('refits when the insets change while fitted, and holds zoom when not', () => {
    const v = create(3024, 4032); // portrait, so the height is what limits the fit
    const before = v.zoom;
    v.setInsets({ top: 60, bottom: 426, left: 0, right: 0 });
    expect(v.zoom).toBeLessThan(before);
    v.zoomAt(100, 100, v.zoom * 3);
    const zoomed = v.zoom;
    v.setInsets({ top: 60, bottom: 100, left: 0, right: 0 });
    expect(v.zoom).toBe(zoomed);
  });

  it('never leaves a gap inside the uncovered area when zoomed in', () => {
    const v = create();
    v.zoomAt(196, 426, v.fitZoom * 4);
    v.panBy(10_000, 10_000);
    const tl = v.imageToView(0, 0);
    expect(tl.x).toBeLessThanOrEqual(0.001);
    expect(tl.y).toBeLessThanOrEqual(0.001);
    v.panBy(-100_000, -100_000);
    const br = v.imageToView(4000, 3000);
    expect(br.x).toBeGreaterThanOrEqual(393 - 0.001);
    expect(br.y).toBeGreaterThanOrEqual(852 - 0.001);
  });

  it('clamps zoom between fit and 16 image pixels per device pixel', () => {
    const v = create();
    v.zoomAt(0, 0, 1e9);
    expect(v.zoom).toBeCloseTo(16 / 3, 6);
    v.zoomAt(0, 0, 1e-9);
    expect(v.zoom).toBeCloseTo(v.fitZoom, 6);
  });

  it('reports 100% at one image pixel per device pixel', () => {
    const v = create();
    v.zoomAt(0, 0, v.actualZoom);
    expect(v.percent).toBe(100);
  });

  it('copes with a 1 x 1 image and with a 100-megapixel one', () => {
    const tiny = create(1, 1);
    expect(Number.isFinite(tiny.zoom)).toBe(true);
    expect(tiny.imageToView(1, 1).x).toBeLessThanOrEqual(393);
    const huge = create(12_000, 8_400);
    expect(huge.zoom).toBeGreaterThan(0);
    expect(huge.imageToView(12_000, 8_400).x).toBeLessThanOrEqual(393 + 0.01);
  });

  it('ignores a zero-size viewport without producing NaN', () => {
    const v = new ViewTransform();
    v.setViewport(0, 0);
    v.setImage(100, 100, true);
    expect(Number.isNaN(v.zoom)).toBe(false);
    expect(Number.isNaN(v.offsetX)).toBe(false);
  });
});
