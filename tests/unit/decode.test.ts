import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fitPixels, formatMP, sniffFormat } from '../../src/engine/decode';

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../fixtures/${name}`, import.meta.url)));
const bytes = (...b: number[]) => new Uint8Array([...b, ...new Array(Math.max(0, 16 - b.length)).fill(0)]);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

describe('sniffFormat', () => {
  it('identifies real files by content, not name', () => {
    expect(sniffFormat(fixture('dusk-portrait.jpg'))).toBe('jpeg');
    expect(sniffFormat(fixture('not-an-image.jpg'))).toBe('unknown');
  });

  it('recognises the formats iOS hands us', () => {
    expect(sniffFormat(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('png');
    expect(sniffFormat(bytes(...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP')))).toBe('webp');
    expect(sniffFormat(bytes(0, 0, 0, 0x18, ...ascii('ftypheic')))).toBe('heic');
    expect(sniffFormat(bytes(0, 0, 0, 0x18, ...ascii('ftypmif1')))).toBe('heic');
    expect(sniffFormat(bytes(0, 0, 0, 0x18, ...ascii('ftypavif')))).toBe('avif');
    expect(sniffFormat(bytes(...ascii('GIF89a')))).toBe('gif');
  });

  it('treats short, empty or random data as unknown without throwing', () => {
    expect(sniffFormat(new Uint8Array())).toBe('unknown');
    expect(sniffFormat(new Uint8Array([0xff, 0xd8]))).toBe('unknown');
    let seed = 42;
    for (let i = 0; i < 2000; i++) {
      const b = new Uint8Array(32).map(() => ((seed = (seed * 16807) % 2147483647) & 0xff));
      expect(() => sniffFormat(b)).not.toThrow();
    }
  });
});

describe('fitPixels (working-copy budget)', () => {
  const budget = 4096 * 4096;

  it('leaves images within the budget alone (never upscales)', () => {
    expect(fitPixels(4032, 3024, budget)).toEqual({ width: 4032, height: 3024 });
    expect(fitPixels(1, 1, budget)).toEqual({ width: 1, height: 1 });
  });

  it('brings a 48 MP iPhone 14 Pro photo under the budget, keeping its shape', () => {
    const r = fitPixels(8064, 6048, budget);
    expect(r.width * r.height).toBeLessThanOrEqual(budget);
    expect(r.width / r.height).toBeCloseTo(8064 / 6048, 2);
    expect(r.width * r.height).toBeGreaterThan(budget * 0.99);
  });

  it('handles extreme panoramas without a zero side', () => {
    const r = fitPixels(65_535, 300, budget);
    expect(r.width).toBeGreaterThan(0);
    expect(r.height).toBeGreaterThan(0);
    expect(r.width * r.height).toBeLessThanOrEqual(budget);
  });
});

describe('formatMP', () => {
  it("doesn't round a reduced copy up past the limit", () => {
    expect(formatMP(4096, 4096)).toBe('16.7 MP');
    expect(formatMP(8064, 6048)).toBe('49 MP');
  });
});
