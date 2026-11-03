import { describe, expect, it } from 'vitest';
import { History, type Exchangeable } from '../../src/engine/history';
import type { Pixels } from '../../src/engine/ops';
import type { Rect } from '../../src/engine/geometry';
import type { MarkupEl } from '../../src/engine/markup';

/** A tiny document: a grey-level picture as a plain array. */
class FakeDoc implements Exchangeable {
  w = 4;
  h = 4;
  px: Uint8ClampedArray = new Uint8ClampedArray(4 * 4 * 4);
  markup: MarkupEl[] = [];
  alpha = false;
  readRegion(r: Rect): Pixels {
    const out = new Uint8ClampedArray(r.w * r.h * 4);
    for (let y = 0; y < r.h; y++) out.set(this.px.subarray(((r.y + y) * this.w + r.x) * 4, ((r.y + y) * this.w + r.x + r.w) * 4), y * r.w * 4);
    return { data: out, width: r.w, height: r.h };
  }
  writeRegion(r: Rect, p: Pixels) {
    for (let y = 0; y < r.h; y++) this.px.set(p.data.subarray(y * r.w * 4, (y + 1) * r.w * 4), ((r.y + y) * this.w + r.x) * 4);
  }
  swapRaster(p: Pixels, alpha: boolean) {
    const prev = { px: { data: this.px, width: this.w, height: this.h }, alpha: this.alpha };
    this.px = p.data;
    this.w = p.width;
    this.h = p.height;
    this.alpha = alpha;
    return prev;
  }
  fill(v: number) {
    this.px.fill(v);
  }
}

describe('history', () => {
  it('region steps undo and redo exactly', async () => {
    const doc = new FakeDoc();
    const h = new History();
    const r = { x: 1, y: 1, w: 2, h: 2 };
    const before = doc.readRegion(r);
    doc.writeRegion(r, { data: new Uint8ClampedArray(16).fill(200), width: 2, height: 2 });
    h.push(h.regionStep('Blur', r, before));
    expect(doc.readRegion(r).data[0]).toBe(200);
    await h.undo(doc);
    expect(doc.readRegion(r).data[0]).toBe(0);
    await h.redo(doc);
    expect(doc.readRegion(r).data[0]).toBe(200);
  });

  it('raster steps swap size, pixels and markup', async () => {
    const doc = new FakeDoc();
    const h = new History();
    const el: MarkupEl = { id: 'a', kind: 'line', style: { color: '#000', width: 1 }, x1: 0, y1: 0, x2: 1, y2: 1 };
    doc.markup = [el];
    const step = h.rasterStep('Crop', doc.readRegion({ x: 0, y: 0, w: 4, h: 4 }), doc.markup, false);
    doc.swapRaster({ data: new Uint8ClampedArray(2 * 2 * 4).fill(9), width: 2, height: 2 }, false);
    doc.markup = [];
    h.push(step);
    await h.undo(doc);
    expect(doc.w).toBe(4);
    expect(doc.markup).toEqual([el]);
    await h.redo(doc);
    expect(doc.w).toBe(2);
    expect(doc.markup).toEqual([]);
  });

  it('a new edit clears redo, and rollback returns to a point', async () => {
    const doc = new FakeDoc();
    const h = new History();
    for (let i = 0; i < 3; i++) {
      const before = doc.markup;
      doc.markup = [...before, { id: String(i), kind: 'line', style: { color: '#000', width: 1 }, x1: 0, y1: 0, x2: i, y2: i }];
      h.push(h.markupStep('Draw', before));
    }
    await h.undo(doc);
    expect(h.canRedo).toBe(true);
    const before = doc.markup;
    doc.markup = [];
    h.push(h.markupStep('Clear', before));
    expect(h.canRedo).toBe(false);
    await h.rollback(doc, 1);
    expect(doc.markup).toHaveLength(1);
    expect(h.length).toBe(1);
  });

  it('keeps at most 60 steps', () => {
    const h = new History();
    for (let i = 0; i < 80; i++) h.push(h.markupStep('x', []));
    expect(h.length).toBe(60);
  });
});
