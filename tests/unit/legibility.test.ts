import { describe, expect, it } from 'vitest';
import { contrastRatio, decideTone, relativeLuminance } from '../../src/engine/legibility';

const fill = (l: number, n = 64) => Array.from({ length: n }, () => l);
const DARK_TINT = relativeLuminance(18, 18, 20);

/** Effective background after the tint is applied, as the glass renders it. */
const blend = (bg: number, tint: number, a: number) => a * tint + (1 - a) * bg;

describe('glass legibility', () => {
  it('uses white glyphs over a dark photo with no extra scrim', () => {
    const d = decideTone(fill(0.02), 0.1);
    expect(d.tone).toBe('light');
    expect(d.alpha).toBe(0.1);
  });

  it('uses black glyphs over a bright photo', () => {
    const d = decideTone(fill(0.9), 0.1);
    expect(d.tone).toBe('dark');
  });

  it('adds enough scrim over a mid-grey photo to reach 4.5:1', () => {
    const bg = 0.3;
    const d = decideTone(fill(bg), 0.1);
    const gain = 1.18;
    const eff = d.tone === 'light' ? blend(bg * gain, DARK_TINT, d.alpha) : blend(bg * gain, 1, d.alpha);
    const fg = d.tone === 'light' ? 1 : 0;
    expect(contrastRatio(fg, eff)).toBeGreaterThanOrEqual(4.5);
  });

  it('stays readable over both the darkest and brightest parts of a busy background', () => {
    const busy = [...fill(0.02, 50), ...fill(0.95, 14)];
    const d = decideTone(busy, 0.1);
    const gain = 1.18;
    for (const bg of [0.02, 0.95]) {
      const b = Math.min(1, bg * gain);
      const eff = d.tone === 'light' ? blend(b, DARK_TINT, d.alpha) : blend(b, 1, d.alpha);
      expect(contrastRatio(d.tone === 'light' ? 1 : 0, eff)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("doesn't flip back and forth on a borderline background", () => {
    const borderline = fill(0.2);
    const first = decideTone(borderline, 0.1);
    const again = decideTone(fill(0.205), 0.1, first.tone);
    expect(again.tone).toBe(first.tone);
  });

  it('computes WCAG luminance and contrast correctly', () => {
    expect(relativeLuminance(255, 255, 255)).toBeCloseTo(1, 6);
    expect(relativeLuminance(0, 0, 0)).toBe(0);
    expect(contrastRatio(1, 0)).toBeCloseTo(21, 6);
  });
});
