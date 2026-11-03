import type { Doc } from './document';
import { drawAll, unionBounds } from './markup';
import { ctx2d, readPixels, writePixels } from './raster';
import { encodeImage, encodeToSize } from './worker';
import { extractUprightExif, insertJpegSegment, stripMetadata } from './metadata';
import type { Format, Pixels } from './ops';
import { splitName } from './rename';

export const MIME: Record<Format, string> = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
export const EXT: Record<Format, string> = { jpeg: 'jpg', png: 'png', webp: 'webp' };
export const FORMAT_NAME: Record<Format, string> = { jpeg: 'JPEG', png: 'PNG', webp: 'WebP' };

export interface ExportSettings {
  format: Format;
  mode: 'quality' | 'target';
  quality: number;
  targetBytes: number;
  optimisePng: boolean;
  stripMetadata: boolean;
  fileName: string;
}

export interface ExportResult {
  file: File;
  width: number;
  height: number;
  quality: number;
  met: boolean;
  /** Things the person should know: reduced to fit, camera info kept or not, transparency lost. */
  notes: string[];
}

/** "Holiday.jpg" -> "Holiday edited.webp". Always a new name, so nothing is replaced. */
export function exportName(name: string, format: Format, suffix = ' edited'): string {
  const { stem } = splitName(name);
  return `${stem}${suffix}.${EXT[format]}`;
}

export function withExtension(name: string, format: Format) {
  const { stem } = splitName(name.trim() || 'Photo');
  return `${stem}.${EXT[format]}`;
}

/**
 * The picture as it will be saved: pixels with markup drawn in. Markup is drawn into the
 * working canvas just for the read, then the covered area is put back, so no second
 * full-size canvas is needed (iOS canvas memory is tight).
 */
export function composite(doc: Doc): Pixels {
  const b = unionBounds(doc.markup);
  if (!b) return readPixels(doc.raster);
  const x0 = Math.max(0, Math.floor(b.x));
  const y0 = Math.max(0, Math.floor(b.y));
  const x1 = Math.min(doc.width, Math.ceil(b.x + b.w));
  const y1 = Math.min(doc.height, Math.ceil(b.y + b.h));
  if (x1 <= x0 || y1 <= y0) return readPixels(doc.raster);
  const region = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  const saved = readPixels(doc.raster, region);
  const ctx = ctx2d(doc.raster);
  ctx.save();
  drawAll(ctx, doc.markup);
  ctx.restore();
  const out = readPixels(doc.raster);
  writePixels(doc.raster, saved, x0, y0);
  return out;
}

export async function renderExport(doc: Doc, s: ExportSettings, progress?: (f: number) => void): Promise<ExportResult> {
  const px = composite(doc);
  const notes: string[] = [];
  const res =
    s.mode === 'target'
      ? await encodeToSize(px, s.format, s.targetBytes, s.optimisePng, progress)
      : await encodeImage(px, { format: s.format, quality: s.quality, optimise: s.optimisePng });
  let bytes = res.bytes;

  if (res.width !== doc.width) notes.push(`Reduced to ${res.width} × ${res.height} to fit the size.`);
  if (s.mode === 'target' && !res.met) notes.push('Couldn’t get it that small; this is the smallest it would go.');
  if (doc.hasAlpha && s.format === 'jpeg') notes.push('JPEG has no transparency, so transparent areas are white.');

  if (!s.stripMetadata) {
    if (s.format === 'jpeg' && doc.format === 'jpeg' && doc.original) {
      const orig = new Uint8Array(await doc.original.slice(0, 256 * 1024).arrayBuffer());
      const seg = extractUprightExif(orig);
      if (seg) {
        bytes = insertJpegSegment(bytes, seg);
        notes.push('Camera details and location kept.');
      }
    } else if (doc.meta?.hasExif) {
      notes.push('Camera details can only be kept when saving a JPEG as JPEG.');
    }
  }

  const name = withExtension(s.fileName || exportName(doc.name, s.format), s.format);
  const file = new File([bytes as BlobPart], name, { type: MIME[s.format], lastModified: Date.now() });
  return { file, width: res.width, height: res.height, quality: res.quality, met: res.met, notes };
}

/**
 * A copy of the original file without location, camera or author details. Rewrites the
 * container when it can (no recompression); otherwise re-encodes the pixels, and says so.
 */
export async function cleanOriginal(doc: Doc): Promise<{ file: File; recompressed: boolean } | null> {
  if (!doc.original) return null;
  const bytes = new Uint8Array(await doc.original.arrayBuffer());
  const stripped = stripMetadata(bytes);
  const { stem, ext } = splitName(doc.name);
  if (stripped) {
    const type = doc.format === 'png' ? 'image/png' : doc.format === 'webp' ? 'image/webp' : 'image/jpeg';
    return { file: new File([stripped as BlobPart], `${stem} no details${ext || '.jpg'}`, { type }), recompressed: false };
  }
  // HEIC, damaged files, anything we can't rewrite safely: fresh pixels can't carry anything hidden.
  const bmp = await createImageBitmap(doc.original, { imageOrientation: 'from-image' });
  const c = document.createElement('canvas');
  const k = Math.min(1, Math.sqrt(doc.width * doc.height) / Math.sqrt(bmp.width * bmp.height));
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  ctx2d(c).drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  const px = readPixels(c);
  c.width = c.height = 0;
  const res = await encodeImage(px, { format: 'jpeg', quality: 92 });
  return { file: new File([res.bytes as BlobPart], `${stem} no details.jpg`, { type: 'image/jpeg' }), recompressed: true };
}

// ---------- handing files over ----------

export const canShareFiles = (files: File[]) => {
  try {
    return typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files });
  } catch {
    return false;
  }
};

/** Must be called straight from a tap, with the file already made: iOS rejects a share after an await. */
export function shareFiles(files: File[], title?: string): Promise<'shared' | 'cancelled' | 'unsupported'> {
  if (!canShareFiles(files)) return Promise.resolve('unsupported');
  return navigator.share({ files, title }).then(
    () => 'shared' as const,
    (e: DOMException) => (e?.name === 'AbortError' ? 'cancelled' : Promise.reject(e)),
  );
}

export function downloadFile(file: Blob, name: string) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Clipboard images must be PNG. Pass a promise so Safari keeps the tap's permission. */
export async function copyPng(png: Promise<Blob>): Promise<boolean> {
  try {
    if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) return false;
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    return true;
  } catch {
    return false;
  }
}
