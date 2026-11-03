/**
 * Keeps text and icons on glass readable over any photo. Given luminance samples from behind a
 * control, pick the foreground (white or black) that needs the least extra scrim to reach
 * 4.5:1, and how opaque the glass tint must be to get there.
 */

/** WCAG relative luminance of an sRGB colour (0-255 channels). */
export function relativeLuminance(r: number, g: number, b: number): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(l1: number, l2: number): number {
  const [a, b] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (a + 0.05) / (b + 0.05);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[i];
}

export type Tone = 'light' | 'dark';

export interface ToneDecision {
  /** 'light' = white foreground on a dark tint; 'dark' = black foreground on a light tint. */
  tone: Tone;
  /** Opacity for the glass tint. */
  alpha: number;
}

// Tint colours used by .glass.clear[data-tone]; see glass.css.
const DARK_TINT_L = relativeLuminance(18, 18, 20);
const LIGHT_TINT_L = 1;
const TARGET = 4.5;
/** Glass brightens what's behind it (brightness(1.08) on the clear variant). */
const BACKDROP_GAIN = 1.18;

/**
 * @param lums luminance samples (0-1) of the area behind the control
 * @param baseAlpha the tint opacity the design uses when nothing more is needed
 * @param previous last decision, so small changes don't flip the tone back and forth
 */
export function decideTone(lums: number[], baseAlpha = 0.1, previous?: Tone): ToneDecision {
  const sorted = [...lums].sort((a, b) => a - b);
  const hi = Math.min(1, percentile(sorted, 0.9) * BACKDROP_GAIN);
  const lo = Math.min(1, percentile(sorted, 0.1) * BACKDROP_GAIN);

  // White text: background must be at most this bright.
  const maxForWhite = 1.05 / TARGET - 0.05;
  const needWhite = hi <= maxForWhite ? 0 : (hi - maxForWhite) / (hi - DARK_TINT_L);
  // Black text: background must be at least this bright.
  const minForBlack = 0.05 * TARGET - 0.05;
  const needBlack = lo >= minForBlack ? 0 : (minForBlack - lo) / (LIGHT_TINT_L - lo);

  const bias = 0.06;
  let tone: Tone;
  if (previous === 'light') tone = needWhite <= needBlack + bias ? 'light' : 'dark';
  else if (previous === 'dark') tone = needBlack <= needWhite + bias ? 'dark' : 'light';
  else tone = needWhite <= needBlack ? 'light' : 'dark';

  const need = tone === 'light' ? needWhite : needBlack;
  const alpha = Math.min(0.88, Math.max(baseAlpha, need + 0.04));
  return { tone, alpha: Math.round(alpha * 100) / 100 };
}

/** Luminance samples from RGBA pixel data. */
export function luminances(data: Uint8ClampedArray): number[] {
  const out: number[] = [];
  for (let i = 0; i < data.length; i += 4) out.push(relativeLuminance(data[i], data[i + 1], data[i + 2]));
  return out;
}
