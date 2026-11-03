import { useEffect, useState } from 'preact/hooks';
import type { ToolHost } from './host';
import { formatMP } from '../engine/decode';
import { formatLocation } from '../engine/metadata';
import { canShareFiles, cleanOriginal, downloadFile, shareFiles } from '../engine/export';
import { canvasBudget } from '../engine/probe';
import { formatBytes } from '../engine/format';
import { Button } from '../ui/Button';
import { showToast } from '../app/overlays';

const FORMAT_NAMES: Record<string, string> = {
  jpeg: 'JPEG', png: 'PNG', gif: 'GIF', webp: 'WebP', heic: 'HEIC', avif: 'AVIF', bmp: 'BMP', tiff: 'TIFF', unknown: 'Unknown',
};

/** What the photo is and what it says about you, with a way to hand out a copy that says nothing. */
export function DetailsTool({ host }: { host: ToolHost }) {
  const { doc } = host;
  const m = doc.meta;
  const [clean, setClean] = useState<{ file: File; recompressed: boolean } | null>(null);
  const [making, setMaking] = useState(false);

  useEffect(() => host.setActions({ noApply: true }), []);

  const rows: [string, string | undefined][] = [
    ['Name', doc.name],
    ['Format', FORMAT_NAMES[doc.format] ?? doc.format],
    ['File Size', doc.originalBytes ? formatBytes(doc.originalBytes) : undefined],
    ['Original', `${doc.originalWidth} × ${doc.originalHeight} · ${formatMP(doc.originalWidth, doc.originalHeight)}`],
    ['Editing At', `${doc.width} × ${doc.height} · ${formatMP(doc.width, doc.height)}`],
    ['Colour', m?.colorProfile ? `${m.colorProfile}${m.wideGamut ? ' → sRGB' : ''}` : 'sRGB'],
    ['Camera', m?.camera],
    ['Lens', m?.lens],
    ['Exposure', m?.exposure],
    ['Taken', m?.taken?.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3')],
    ['Location', m?.location ? formatLocation(m.location) : undefined],
    ['Author', m?.author],
    ['Copyright', m?.copyright],
    ['Software', m?.software],
  ];

  const prepare = async () => {
    setMaking(true);
    try {
      setClean(await cleanOriginal(doc));
    } catch {
      showToast({ icon: 'details', title: 'Couldn’t make a clean copy', duration: 2400 });
    } finally {
      setMaking(false);
    }
  };

  const give = () => {
    if (!clean) return;
    if (canShareFiles([clean.file])) void shareFiles([clean.file], clean.file.name).catch(() => downloadFile(clean.file, clean.file.name));
    else downloadFile(clean.file, clean.file.name);
  };

  const found = m && [m.location && 'location', m.camera && 'camera', (m.author || m.copyright) && 'author', m.hasXmp && 'XMP', m.hasIptc && 'IPTC'].filter(Boolean);
  const { budget } = canvasBudget();

  return (
    <div class="tool-body">
      <dl class="details-list">
        {rows
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div class="details-row">
              <dt>{k}</dt>
              <dd class="t-num">{v}</dd>
            </div>
          ))}
      </dl>
      {doc.reduced ? (
        <p class="tool-note">
          This photo is bigger than this device lets a web app edit in one piece (about {formatMP(1, budget)} here), so you’re editing a copy reduced to {formatMP(doc.width, doc.height)}. The original isn’t changed.
        </p>
      ) : (
        <p class="tool-note">You’re editing at full resolution.</p>
      )}
      {m?.wideGamut && <p class="tool-note">The original uses a wide colour space ({m.colorProfile}). PicKit edits and exports in sRGB, so the most saturated colours may look slightly calmer.</p>}

      <h3 class="preset-group">Privacy</h3>
      {found && found.length ? (
        <>
          <p class="tool-note">The original file carries: {found.join(', ')}. Exports from PicKit leave these out unless you turn off “Remove Location & Camera Info”.</p>
          {!clean ? (
            <Button variant="gray" label={making ? 'Making a Clean Copy…' : 'Make a Copy Without Details'} disabled={making || !doc.original} onClick={() => void prepare()} />
          ) : (
            <>
              <Button variant="filled" icon="share" label={`Share ${clean.file.name}`} onClick={give} />
              <p class="tool-note">
                {clean.recompressed
                  ? 'This file type can’t be cleaned without re-encoding, so the copy is a fresh JPEG of the photo (unedited).'
                  : 'Made by rewriting the file’s container: the picture itself isn’t recompressed.'}{' '}
                {formatBytes(clean.file.size)}.
              </p>
            </>
          )}
        </>
      ) : (
        <p class="tool-note">No location, camera or author details found in the original.</p>
      )}
    </div>
  );
}
