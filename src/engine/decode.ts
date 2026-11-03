/**
 * Turns a picked file into pixels the editor can show. EXIF orientation is baked in at import.
 * Hostile or damaged files are expected input: they fail with a plain message, never hang.
 *
 * Phase 0 keeps the working copy under a conservative 16.7 MP, the historical iOS canvas limit,
 * and says so when it reduces a photo. Phase 1 replaces the constant with a probe of the real
 * limit on the device.
 */
export const DEFAULT_MAX_WORKING_PIXELS = 4096 * 4096;
const DECODE_TIMEOUT_MS = 20_000;

export class ImageOpenError extends Error {
  constructor(
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'ImageOpenError';
  }
}

export interface DecodedImage {
  bitmap: ImageBitmap;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  /** True when the working copy is smaller than the original. */
  reduced: boolean;
  name: string;
  type: string;
  bytes: number;
  format: SniffedFormat;
}

export type SniffedFormat = 'jpeg' | 'png' | 'gif' | 'webp' | 'heic' | 'avif' | 'bmp' | 'tiff' | 'unknown';

/** Identify a file by its first bytes, not its name or claimed type. */
export function sniffFormat(b: Uint8Array): SniffedFormat {
  if (b.length < 12) return 'unknown';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'gif';
  const ascii = (from: number, len: number) => String.fromCharCode(...b.subarray(from, from + len));
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'webp';
  if (ascii(4, 4) === 'ftyp') {
    const brand = ascii(8, 4);
    if (brand === 'avif' || brand === 'avis') return 'avif';
    if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].includes(brand)) return 'heic';
  }
  if (b[0] === 0x42 && b[1] === 0x4d) return 'bmp';
  if ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0) || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0 && b[3] === 0x2a)) return 'tiff';
  return 'unknown';
}

/** Largest size with the same aspect ratio that fits in `maxPixels`. */
export function fitPixels(width: number, height: number, maxPixels: number): { width: number; height: number } {
  if (width * height <= maxPixels) return { width, height };
  const scale = Math.sqrt(maxPixels / (width * height));
  let w = Math.max(1, Math.floor(width * scale));
  let h = Math.max(1, Math.floor(height * scale));
  while (w * h > maxPixels) {
    if (w >= h) w--;
    else h--;
  }
  return { width: w, height: h };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new ImageOpenError("This file can't be opened.", 'Decoding took too long.')), ms);
    p.then(
      (v) => {
        clearTimeout(id);
        resolve(v);
      },
      (e) => {
        clearTimeout(id);
        reject(e);
      },
    );
  });
}

async function bitmapFromBlob(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    // Older WebKit rejects some option values; fall back to an <img>, which honours EXIF orientation.
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    if (!img.naturalWidth || !img.naturalHeight) throw new Error('empty image');
    return await createImageBitmap(img);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function downscale(src: ImageBitmap, width: number, height: number): Promise<ImageBitmap> {
  try {
    const out = await createImageBitmap(src, { resizeWidth: width, resizeHeight: height, resizeQuality: 'high' });
    if (out.width === width && out.height === height) return out;
    out.close();
  } catch {
    /* resize options unsupported: draw through a canvas instead */
  }
  // Halve in steps so a big reduction stays smooth, then land on the exact size.
  let cur: CanvasImageSource = src;
  let cw = src.width;
  let ch = src.height;
  const temps: HTMLCanvasElement[] = [];
  while (cw / 2 >= width && ch / 2 >= height && (cw / 2) * (ch / 2) <= DEFAULT_MAX_WORKING_PIXELS) {
    const c = document.createElement('canvas');
    c.width = Math.floor(cw / 2);
    c.height = Math.floor(ch / 2);
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(cur, 0, 0, c.width, c.height);
    temps.push(c);
    cur = c;
    cw = c.width;
    ch = c.height;
  }
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(cur, 0, 0, width, height);
  const bmp = await createImageBitmap(c);
  for (const t of temps) t.width = t.height = 0;
  c.width = c.height = 0;
  return bmp;
}

export async function decodeFile(file: Blob, name: string, maxPixels = DEFAULT_MAX_WORKING_PIXELS): Promise<DecodedImage> {
  if (file.size === 0) throw new ImageOpenError("This file can't be opened.", 'The file is empty.');
  const head = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  const format = sniffFormat(head);

  let bitmap: ImageBitmap;
  try {
    bitmap = await withTimeout(bitmapFromBlob(file), DECODE_TIMEOUT_MS);
  } catch (e) {
    if (e instanceof ImageOpenError) throw e;
    throw new ImageOpenError(
      "This file can't be opened.",
      format === 'unknown' ? "It doesn't look like an image." : `The ${format.toUpperCase()} data is damaged or unsupported.`,
    );
  }

  const originalWidth = bitmap.width;
  const originalHeight = bitmap.height;
  if (!originalWidth || !originalHeight) {
    bitmap.close();
    throw new ImageOpenError("This file can't be opened.", 'The image has no pixels.');
  }

  let reduced = false;
  const target = fitPixels(originalWidth, originalHeight, maxPixels);
  if (target.width !== originalWidth || target.height !== originalHeight) {
    const small = await downscale(bitmap, target.width, target.height);
    bitmap.close();
    bitmap = small;
    reduced = true;
  }

  return {
    bitmap,
    width: bitmap.width,
    height: bitmap.height,
    originalWidth,
    originalHeight,
    reduced,
    name,
    type: file.type,
    bytes: file.size,
    format,
  };
}

export const megapixels = (w: number, h: number) => (w * h) / 1_000_000;

/** "16.8 MP", "48 MP": one decimal below 20 MP, where rounding would mislead. */
export function formatMP(w: number, h: number): string {
  const mp = megapixels(w, h);
  return mp < 20 ? `${(Math.floor(mp * 10) / 10).toFixed(1)} MP` : `${Math.round(mp)} MP`;
}
