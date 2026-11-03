/**
 * Pixel work that runs off the main thread: encoding with the WASM codecs (MozJPEG, PNG,
 * OxiPNG, WebP), encoding to a target file size, blur, pixelate and resampling. Used by
 * engine.worker.ts, and directly as a fallback where workers aren't available.
 */
export type Format = 'jpeg' | 'png' | 'webp';

export interface Pixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface EncodeOptions {
  format: Format;
  /** 1-100. Ignored for PNG. */
  quality: number;
  /** PNG only: run OxiPNG for a smaller file (slower). */
  optimise?: boolean;
}

export interface EncodeResult {
  bytes: Uint8Array;
  width: number;
  height: number;
  quality: number;
  /** For target-size encodes: whether the result fits. */
  met: boolean;
}

const toImageData = (p: Pixels) =>
  typeof ImageData !== 'undefined' ? new ImageData(p.data as Uint8ClampedArray<ArrayBuffer>, p.width, p.height) : (p as unknown as ImageData);

export function hasTransparency(p: Pixels): boolean {
  const d = p.data;
  for (let i = 3; i < d.length; i += 4) if (d[i] !== 255) return true;
  return false;
}

/** JPEG has no transparency: composite onto white so transparent areas don't turn black. */
export function flattenOnWhite(p: Pixels): Pixels {
  if (!hasTransparency(p)) return p;
  const d = new Uint8ClampedArray(p.data);
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] / 255;
    d[i] = d[i] * a + 255 * (1 - a);
    d[i + 1] = d[i + 1] * a + 255 * (1 - a);
    d[i + 2] = d[i + 2] * a + 255 * (1 - a);
    d[i + 3] = 255;
  }
  return { data: d, width: p.width, height: p.height };
}

export async function encode(p: Pixels, o: EncodeOptions): Promise<Uint8Array> {
  const q = Math.round(Math.min(100, Math.max(1, o.quality)));
  if (o.format === 'jpeg') {
    const { default: enc } = await import('@jsquash/jpeg/encode.js');
    return new Uint8Array(await enc(toImageData(flattenOnWhite(p)), { quality: q, progressive: true, optimize_coding: true }));
  }
  if (o.format === 'webp') {
    const { default: enc } = await import('@jsquash/webp/encode.js');
    return new Uint8Array(await enc(toImageData(p), { quality: q, method: 4 }));
  }
  if (o.optimise) {
    const ox = await import('@jsquash/oxipng/codec/pkg/squoosh_oxipng.js');
    await ox.default();
    return ox.optimise_raw(p.data, p.width, p.height, 2, false, true);
  }
  const { default: enc } = await import('@jsquash/png/encode.js');
  return new Uint8Array(await enc(toImageData(p)));
}

// ---------- resampling ----------

/** Area-averaging downscale (sharp and alias-free); bilinear when enlarging. */
export function resizePixels(p: Pixels, w: number, h: number): Pixels {
  w = Math.max(1, Math.round(w));
  h = Math.max(1, Math.round(h));
  if (w === p.width && h === p.height) return p;
  if (w > p.width || h > p.height) return bilinear(p, w, h);
  const src = p.data;
  const out = new Uint8ClampedArray(w * h * 4);
  const sx = p.width / w;
  const sy = p.height / h;
  for (let y = 0; y < h; y++) {
    const y0 = y * sy;
    const y1 = y0 + sy;
    for (let x = 0; x < w; x++) {
      const x0 = x * sx;
      const x1 = x0 + sx;
      let r = 0, g = 0, b = 0, a = 0, wsum = 0;
      for (let yy = Math.floor(y0); yy < Math.ceil(y1); yy++) {
        const wy = Math.min(y1, yy + 1) - Math.max(y0, yy);
        if (wy <= 0) continue;
        for (let xx = Math.floor(x0); xx < Math.ceil(x1); xx++) {
          const wx = Math.min(x1, xx + 1) - Math.max(x0, xx);
          if (wx <= 0) continue;
          const wgt = wx * wy;
          const i = (yy * p.width + xx) * 4;
          const al = src[i + 3] * wgt;
          r += src[i] * al;
          g += src[i + 1] * al;
          b += src[i + 2] * al;
          a += al;
          wsum += wgt;
        }
      }
      const o = (y * w + x) * 4;
      if (a > 0) {
        out[o] = r / a;
        out[o + 1] = g / a;
        out[o + 2] = b / a;
      }
      out[o + 3] = a / wsum;
    }
  }
  return { data: out, width: w, height: h };
}

function bilinear(p: Pixels, w: number, h: number): Pixels {
  const out = new Uint8ClampedArray(w * h * 4);
  const s = p.data;
  const sx = p.width / w;
  const sy = p.height / h;
  for (let y = 0; y < h; y++) {
    const fy = Math.min(p.height - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(p.height - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(p.width - 1, Math.max(0, (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(p.width - 1, x0 + 1);
      const tx = fx - x0;
      const o = (y * w + x) * 4;
      for (let c = 0; c < 4; c++) {
        const a = s[(y0 * p.width + x0) * 4 + c];
        const b = s[(y0 * p.width + x1) * 4 + c];
        const cc = s[(y1 * p.width + x0) * 4 + c];
        const d = s[(y1 * p.width + x1) * 4 + c];
        out[o + c] = (a * (1 - tx) + b * tx) * (1 - ty) + (cc * (1 - tx) + d * tx) * ty;
      }
    }
  }
  return { data: out, width: w, height: h };
}

// ---------- target size ----------

const LOWEST = 30;
const HIGHEST = 95;
const CLOSE_ENOUGH = 0.92;
const MAX_ROUNDS = 8;
const SMALLEST_SIDE = 16;

export type Encoder = (p: Pixels, quality: number) => Promise<Uint8Array>;

/**
 * Compress to fit `target` bytes, following PicKit for Windows (Imaging/Compression.cs):
 * binary-search quality between 30 and 95; if even 30 is too big, scale down by the square
 * root of the overshoot and try again. Returns the smallest attempt if nothing fits.
 *
 * Big images are searched on a smaller proxy first, then confirmed at full size, so a 12 MP
 * photo takes a few encodes rather than a dozen.
 */
export async function encodeToTarget(
  p: Pixels,
  format: Format,
  target: number,
  encodeAt: Encoder,
  onProgress?: (f: number) => void,
): Promise<EncodeResult> {
  if (target <= 0) throw new Error('Target size must be positive.');
  let current = p;
  let best: EncodeResult | null = null;
  let hint: number | undefined;

  if (format !== 'png' && p.width * p.height > 3_000_000) {
    const k = Math.sqrt(1_500_000 / (p.width * p.height));
    const proxy = resizePixels(p, p.width * k, p.height * k);
    const proxyTarget = target * ((proxy.width * proxy.height) / (p.width * p.height));
    const r = await searchQuality(proxy, proxyTarget, encodeAt);
    hint = r.quality;
  }

  for (let round = 0; round < MAX_ROUNDS; round++) {
    onProgress?.(round / MAX_ROUNDS);
    const attempt =
      format === 'png'
        ? await at(current, 100, target, encodeAt)
        : await searchQuality(current, target, encodeAt, round === 0 ? hint : undefined);
    if (attempt.met) return attempt;
    if (!best || attempt.bytes.length < best.bytes.length) best = attempt;
    const scale = Math.min(Math.sqrt(target / attempt.bytes.length) * 0.95, 0.95);
    const nw = Math.round(current.width * scale);
    const nh = Math.round(current.height * scale);
    if (Math.min(nw, nh) < SMALLEST_SIDE) break;
    current = resizePixels(p, nw, nh);
  }
  return best!;
}

async function at(p: Pixels, quality: number, target: number, enc: Encoder): Promise<EncodeResult> {
  const bytes = await enc(p, quality);
  return { bytes, width: p.width, height: p.height, quality, met: bytes.length <= target };
}

async function searchQuality(p: Pixels, target: number, enc: Encoder, hint?: number): Promise<EncodeResult> {
  let low = LOWEST;
  let high = HIGHEST;
  let fitting: EncodeResult | null = null;
  let smallest: EncodeResult | null = null;
  if (hint !== undefined) {
    // Start around the proxy's answer instead of the middle.
    low = Math.max(LOWEST, hint - 6);
    high = Math.min(HIGHEST, hint + 6);
  }
  while (low <= high) {
    const q = Math.floor((low + high) / 2);
    const r = await at(p, q, target, enc);
    if (!smallest || r.bytes.length < smallest.bytes.length) smallest = r;
    if (!r.met) {
      high = q - 1;
      if (high < low && hint !== undefined && low > LOWEST && !fitting) {
        // The hint was optimistic: widen the window downwards once.
        high = low - 1;
        low = LOWEST;
        hint = undefined;
      }
      continue;
    }
    fitting = r;
    if (r.bytes.length >= target * CLOSE_ENOUGH) break;
    low = q + 1;
  }
  return fitting ?? smallest!;
}

// ---------- privacy effects ----------

/** Blur in place with three box passes (close to a Gaussian), edges clamped. */
export function boxBlur(p: Pixels, radius: number): Pixels {
  const r = Math.max(1, Math.round(radius));
  const { width: w, height: h } = p;
  const a = new Float32Array(w * h * 4);
  const b = new Float32Array(w * h * 4);
  for (let i = 0; i < a.length; i++) a[i] = p.data[i];
  for (let pass = 0; pass < 3; pass++) {
    blurAxis(a, b, w, h, r, true);
    blurAxis(b, a, w, h, r, false);
  }
  const out = new Uint8ClampedArray(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i];
  return { data: out, width: w, height: h };
}

function blurAxis(src: Float32Array, dst: Float32Array, w: number, h: number, r: number, horizontal: boolean) {
  const len = horizontal ? w : h;
  const lines = horizontal ? h : w;
  const norm = 1 / (2 * r + 1);
  const idx = (line: number, i: number) => (horizontal ? (line * w + Math.min(len - 1, Math.max(0, i))) * 4 : (Math.min(len - 1, Math.max(0, i)) * w + line) * 4);
  for (let line = 0; line < lines; line++) {
    for (let c = 0; c < 4; c++) {
      let acc = 0;
      for (let i = -r; i <= r; i++) acc += src[idx(line, i) + c];
      for (let i = 0; i < len; i++) {
        dst[idx(line, i) + c] = acc * norm;
        acc += src[idx(line, i + r + 1) + c] - src[idx(line, i - r) + c];
      }
    }
  }
}

/** Replace each block with its average colour. */
export function pixelate(p: Pixels, block: number, originX = 0, originY = 0): Pixels {
  const s = Math.max(2, Math.round(block));
  const { width: w, height: h } = p;
  const out = new Uint8ClampedArray(p.data);
  // Align blocks to the image grid, not the region, so neighbouring regions line up.
  const startX = -(((originX % s) + s) % s);
  const startY = -(((originY % s) + s) % s);
  for (let by = startY; by < h; by += s) {
    for (let bx = startX; bx < w; bx += s) {
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      const x0 = Math.max(0, bx);
      const y0 = Math.max(0, by);
      const x1 = Math.min(w, bx + s);
      const y1 = Math.min(h, by + s);
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          const i = (y * w + x) * 4;
          r += p.data[i];
          g += p.data[i + 1];
          b += p.data[i + 2];
          a += p.data[i + 3];
          n++;
        }
      if (!n) continue;
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          const i = (y * w + x) * 4;
          out[i] = r / n;
          out[i + 1] = g / n;
          out[i + 2] = b / n;
          out[i + 3] = a / n;
        }
    }
  }
  return { data: out, width: w, height: h };
}
