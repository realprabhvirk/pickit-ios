import type { DecodedImage } from '../engine/decode';
import { formatMP } from '../engine/decode';

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} bytes`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

const FORMAT_NAMES: Record<string, string> = {
  jpeg: 'JPEG',
  png: 'PNG',
  gif: 'GIF',
  webp: 'WebP',
  heic: 'HEIC',
  avif: 'AVIF',
  bmp: 'BMP',
  tiff: 'TIFF',
  unknown: 'Unknown',
};

/** What we know about the photo. Camera, location and author details arrive with Phase 1. */
export function DetailsSheet({ img }: { img: DecodedImage }) {
  const mp = formatMP;
  const rows: [string, string][] = [
    ['Name', img.name],
    ['Format', FORMAT_NAMES[img.format] ?? img.format],
    ['File size', formatBytes(img.bytes)],
    ['Original', `${img.originalWidth} × ${img.originalHeight} · ${mp(img.originalWidth, img.originalHeight)}`],
    ['Editing at', `${img.width} × ${img.height} · ${mp(img.width, img.height)}`],
  ];
  return (
    <div class="tool-body">
      <dl class="details-list">
        {rows.map(([k, v]) => (
          <div class="details-row">
            <dt>{k}</dt>
            <dd class="t-num">{v}</dd>
          </div>
        ))}
      </dl>
      {img.reduced ? (
        <p class="tool-note">
          This photo is larger than this iPhone lets a web app hold in one canvas, so you're editing a copy reduced to{' '}
          {mp(img.width, img.height)}. The original isn't changed. Full-resolution export is planned.
        </p>
      ) : (
        <p class="tool-note">You're editing at full resolution.</p>
      )}
    </div>
  );
}
