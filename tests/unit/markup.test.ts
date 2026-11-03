import { describe, expect, it } from 'vitest';
import { bounds, elementAt, erase, flipH, hitTest, rotateCW, transformEl, translate, type MarkupEl } from '../../src/engine/markup';

const style = { color: '#f00', width: 4 };
const pen = (pts: number[][]): MarkupEl => ({ id: 'p', kind: 'pen', style, points: pts.flatMap(([x, y]) => [x, y, 0.5]) });

describe('markup', () => {
  it('hit-tests each kind within a tolerance', () => {
    const line: MarkupEl = { id: 'l', kind: 'arrow', style, x1: 0, y1: 0, x2: 100, y2: 0 };
    expect(hitTest(line, 50, 3, 2)).toBe(true);
    expect(hitTest(line, 50, 20, 2)).toBe(false);
    const rect: MarkupEl = { id: 'r', kind: 'rect', style, x: 10, y: 10, w: 100, h: 50 };
    expect(hitTest(rect, 10, 30, 2)).toBe(true);
    expect(hitTest(rect, 60, 35, 2)).toBe(false); // inside, away from the outline
    const ell: MarkupEl = { id: 'e', kind: 'ellipse', style, x: 0, y: 0, w: 100, h: 100 };
    expect(hitTest(ell, 100, 50, 2)).toBe(true);
    expect(hitTest(ell, 50, 50, 2)).toBe(false);
  });

  it('picks the topmost element', () => {
    const a: MarkupEl = { id: 'a', kind: 'line', style, x1: 0, y1: 0, x2: 100, y2: 0 };
    const b: MarkupEl = { id: 'b', kind: 'line', style, x1: 0, y1: 0, x2: 100, y2: 0 };
    expect(elementAt([a, b], 50, 0, 2)?.id).toBe('b');
  });

  it('follows the photo through crop, rotate and flip', () => {
    const l: MarkupEl = { id: 'l', kind: 'line', style, x1: 10, y1: 20, x2: 30, y2: 40 };
    expect(transformEl(l, translate(-10, -20))).toMatchObject({ x1: 0, y1: 0, x2: 20, y2: 20 });
    // 100 x 50 image rotated clockwise: (x, y) -> (50 - y, x)
    expect(transformEl(l, rotateCW(50))).toMatchObject({ x1: 30, y1: 10, x2: 10, y2: 30 });
    expect(transformEl(l, flipH(100))).toMatchObject({ x1: 90, x2: 70 });
    const r: MarkupEl = { id: 'r', kind: 'rect', style, x: 0, y: 0, w: 20, h: 10 };
    const rr = transformEl(r, rotateCW(50));
    expect(rr).toMatchObject({ x: 40, y: 0, w: 10, h: 20 });
  });

  it('scales stroke widths with the photo', () => {
    const l: MarkupEl = { id: 'l', kind: 'line', style, x1: 0, y1: 0, x2: 10, y2: 0 };
    const t = transformEl(l, [2, 0, 0, 2, 0, 0]);
    expect(t.style.width).toBeCloseTo(8, 6);
  });

  it('the eraser cuts pen strokes in two and removes touched shapes', () => {
    const stroke = pen([
      [0, 0],
      [100, 0],
    ]);
    const arrow: MarkupEl = { id: 'a', kind: 'arrow', style, x1: 50, y1: -50, x2: 50, y2: 50 };
    const out = erase([stroke, arrow], 50, 0, 50, 0, 5);
    expect(out.filter((e) => e.kind === 'pen')).toHaveLength(2);
    expect(out.some((e) => e.kind === 'arrow')).toBe(false);
  });

  it('leaves the list untouched when nothing is hit', () => {
    const els = [pen([[0, 0], [10, 0]])];
    expect(erase(els, 500, 500, 600, 600, 5)).toBe(els);
  });

  it('bounds include the stroke width', () => {
    const b = bounds(pen([[10, 10], [20, 10]]));
    expect(b.x).toBeCloseTo(8);
    expect(b.w).toBeCloseTo(14);
  });
});
