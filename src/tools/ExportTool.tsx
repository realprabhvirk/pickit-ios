import { useEffect, useRef, useState } from 'preact/hooks';
import type { ToolHost } from './host';
import {
  FORMAT_NAME,
  canShareFiles,
  composite,
  copyPng,
  downloadFile,
  exportName,
  renderExport,
  shareFiles,
  type ExportResult,
  type ExportSettings,
} from '../engine/export';
import type { Format } from '../engine/ops';
import { canvasFromPixels, canvasToBlob, freeCanvas } from '../engine/raster';
import { settings } from '../store/settings';
import { isIOS } from '../app/env';
import { showToast } from '../app/overlays';
import { formatBytes } from '../engine/format';
import { Segmented } from '../ui/Segmented';
import { Slider } from '../ui/Slider';
import { Switch } from '../ui/Switch';
import { Button } from '../ui/Button';

const TARGETS = [250, 500, 1000, 2000, 5000];

/**
 * Compress, convert and export. The file is made as soon as the settings settle (in a
 * worker, with the WASM encoders), so the size shown is the real size and Share can open the
 * iOS share sheet straight from the tap, which iOS requires.
 */
export function ExportTool({ host, focus }: { host: ToolHost; focus: 'export' | 'compress' }) {
  const { doc } = host;
  const s = settings.value;
  const [format, setFormat] = useState<Format>(doc.hasAlpha && s.exportFormat === 'jpeg' ? 'png' : s.exportFormat);
  const [mode, setMode] = useState<'quality' | 'target'>(focus === 'compress' ? 'target' : 'quality');
  const [quality, setQuality] = useState(s.exportQuality);
  const [targetKB, setTargetKB] = useState(1000);
  const [targetText, setTargetText] = useState('1000');
  const [optimise, setOptimise] = useState(false);
  const [strip, setStrip] = useState(s.stripMetadata);
  const [name, setName] = useState(() => exportName(doc.name, format).replace(/\.[^.]+$/, ''));
  const [result, setResult] = useState<ExportResult | null>(null);
  const [busy, setBusy] = useState(true);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const gen = useRef(0);

  useEffect(() => {
    host.setActions({ noApply: true });
  }, []);

  // Make the file whenever settings change (debounced; the latest request wins).
  useEffect(() => {
    const id = ++gen.current;
    setBusy(true);
    setError(null);
    setProgress(0);
    const t = setTimeout(async () => {
      const settingsNow: ExportSettings = {
        format,
        mode: format === 'png' && mode === 'target' ? 'target' : mode,
        quality,
        targetBytes: targetKB * 1000,
        optimisePng: optimise,
        stripMetadata: strip,
        fileName: name,
      };
      try {
        const r = await renderExport(doc, settingsNow, (f) => id === gen.current && setProgress(f));
        if (id !== gen.current) return;
        setResult(r);
      } catch (e) {
        if (id !== gen.current) return;
        setResult(null);
        setError(e instanceof Error ? e.message : 'The file couldn’t be made.');
      } finally {
        if (id === gen.current) setBusy(false);
      }
    }, 380);
    return () => clearTimeout(t);
  }, [format, mode, quality, targetKB, optimise, strip, name, doc.version.value]);

  const done = (what: string) => {
    doc.dirty = false;
    showToast({ icon: 'checkmark', title: what, duration: 1800 });
  };

  const share = () => {
    if (!result) return;
    // Straight from the tap: no awaits before navigator.share.
    shareFiles([result.file], result.file.name).then(
      (r) => {
        if (r === 'shared') done('Shared');
        else if (r === 'unsupported') downloadFile(result.file, result.file.name);
      },
      () => showToast({ icon: 'share', title: 'Couldn’t share', subtitle: 'Try Save to Files instead.', duration: 2600 }),
    );
  };

  const save = () => {
    if (!result) return;
    // On iPhone the share sheet's "Save to Files" is the way into Files.
    if (isIOS() && canShareFiles([result.file])) share();
    else {
      downloadFile(result.file, result.file.name);
      done('Saved');
    }
  };

  const copy = () => {
    // The clipboard wants PNG; hand it a promise so Safari keeps this tap's permission.
    const png =
      result?.file.type === 'image/png'
        ? Promise.resolve(result.file as Blob)
        : (async () => {
            const c = canvasFromPixels(composite(doc));
            try {
              return await canvasToBlob(c, 'image/png');
            } finally {
              freeCanvas(c);
            }
          })();
    void copyPng(png).then((ok) =>
      ok ? showToast({ icon: 'copy', title: 'Copied', subtitle: 'Paste it into any app.', duration: 1800 }) : showToast({ icon: 'copy', title: 'Couldn’t copy', duration: 2200 }),
    );
  };

  const lossy = format !== 'png';
  const targetMode = mode === 'target';
  const orig = doc.originalBytes;

  return (
    <div class="tool-body">
      <Segmented<Format>
        label="Format"
        value={format}
        onChange={(f) => setFormat(f)}
        onGlass
        options={[
          { value: 'jpeg', label: 'JPEG' },
          { value: 'png', label: 'PNG' },
          { value: 'webp', label: 'WebP' },
        ]}
      />
      <Segmented<'quality' | 'target'>
        label="Size by"
        value={mode}
        onChange={setMode}
        onGlass
        options={[
          { value: 'quality', label: lossy ? 'Quality' : 'Lossless' },
          { value: 'target', label: 'File Size' },
        ]}
      />

      {!targetMode && lossy && (
        <>
          <div class="tool-row compact">
            <span>Quality</span>
            <span class="t-num tool-value">{quality}%</span>
          </div>
          <Slider value={quality} min={10} max={100} onChange={setQuality} label="Quality" valueText={(v) => `${v} percent`} />
        </>
      )}
      {!targetMode && !lossy && (
        <div class="tool-row">
          <span>Smaller File (Slower)</span>
          <Switch checked={optimise} onChange={setOptimise} label="Optimise PNG, slower" />
        </div>
      )}
      {targetMode && (
        <>
          <div class="chip-row" role="radiogroup" aria-label="Target size">
            {TARGETS.map((k) => (
              <button
                type="button"
                role="radio"
                aria-checked={targetKB === k}
                class="chip"
                onClick={() => {
                  setTargetKB(k);
                  setTargetText(String(k));
                }}
              >
                {k >= 1000 ? `${k / 1000} MB` : `${k} KB`}
              </button>
            ))}
          </div>
          <label class="tool-row">
            <span>At most</span>
            <span class="row-actions">
              <input
                class="tool-input small t-num"
                type="text"
                inputMode="numeric"
                aria-label="Target size in kilobytes"
                value={targetText}
                onInput={(e) => {
                  const t = (e.currentTarget as HTMLInputElement).value;
                  setTargetText(t);
                  const v = Number(t);
                  if (Number.isFinite(v) && v >= 10) setTargetKB(Math.round(v));
                }}
              />
              <span class="t-secondary">KB</span>
            </span>
          </label>
        </>
      )}

      <div class="estimate" aria-live="polite">
        {busy ? (
          <span class="t-secondary">
            {progress > 0 ? `Fitting to size… ${Math.round(progress * 100)}%` : `Making ${FORMAT_NAME[format]}…`}
          </span>
        ) : error ? (
          <span class="tool-warn">{error}</span>
        ) : result ? (
          <>
            <span class="estimate-size t-num">{formatBytes(result.file.size)}</span>
            <span class="t-secondary t-num">
              {result.width} × {result.height}
              {lossy && ` · quality ${result.quality}`}
              {orig ? ` · original ${formatBytes(orig)}` : ''}
            </span>
            {result.notes.map((n) => (
              <span class="tool-note">{n}</span>
            ))}
          </>
        ) : null}
      </div>

      <div class="button-row">
        <Button variant="filled" icon="share" label="Share" disabled={busy || !result} onClick={share} />
        <Button variant="gray" icon="copy" label="Copy" disabled={busy && !result} onClick={copy} />
        <Button variant="gray" icon="folder" label="Save" disabled={busy || !result} onClick={save} />
      </div>

      <div class="tool-row">
        <span>Remove Location & Camera Info</span>
        <Switch checked={strip} onChange={setStrip} label="Remove location and camera info" />
      </div>
      <label class="tool-field">
        <span class="tool-field-label">File Name</span>
        <span class="row-actions">
          <input
            class="tool-input"
            type="text"
            value={name}
            autocomplete="off"
            autocapitalize="off"
            spellcheck={false}
            aria-label="File name"
            onChange={(e) => setName((e.currentTarget as HTMLInputElement).value)}
          />
          <span class="t-secondary">.{format === 'jpeg' ? 'jpg' : format}</span>
        </span>
      </label>
      <p class="tool-note">Exports are always new files. Your original photo isn’t changed.</p>
    </div>
  );
}
