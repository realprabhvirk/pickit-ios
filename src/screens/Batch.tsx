import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { popScreen } from '../app/nav';
import { showAlert, showToast } from '../app/overlays';
import { NavScreen } from '../ui/NavScreen';
import { Row, Section } from '../ui/List';
import { Segmented } from '../ui/Segmented';
import { Slider } from '../ui/Slider';
import { Switch } from '../ui/Switch';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { decodeFile } from '../engine/decode';
import { canvasBudget } from '../engine/probe';
import { canvasFromSource, canvasToBlob, freeCanvas, readPixels, resizeCanvas, thumbnail } from '../engine/raster';
import { encodeImage, encodeToSize } from '../engine/worker';
import { EXT, MIME, canShareFiles, downloadFile, shareFiles } from '../engine/export';
import { stripMetadata } from '../engine/metadata';
import { naturalSort, previewRenames, splitName, uniqueName, type RenameRule } from '../engine/rename';
import { makeZip } from '../engine/zip';
import { formatBytes } from '../engine/format';
import { planFit } from '../engine/geometry';
import type { Format } from '../engine/ops';
import { settings } from '../store/settings';
import './settings.css';
import './batch.css';

type Op = 'compress' | 'resize' | 'convert' | 'rename';
type OutFormat = Format | 'same';

interface Item {
  id: number;
  file: File;
  width?: number;
  height?: number;
  thumb?: string;
}

interface Output {
  item: Item;
  file?: File;
  error?: string;
}

interface Settings {
  op: Op;
  format: OutFormat;
  quality: number;
  bySize: boolean;
  targetKB: number;
  longEdge: number;
  rule: RenameRule;
  strip: boolean;
}

let itemSeq = 0;

const formatOf = (f: File): Format => (f.type === 'image/png' ? 'png' : f.type === 'image/webp' ? 'webp' : 'jpeg');

function outFormat(s: Settings, f: File): Format {
  if (s.op === 'resize' || s.format === 'same') return formatOf(f);
  return s.format;
}

function outName(s: Settings, item: Item, index: number, all: Item[]): string {
  if (s.op === 'rename') return previewRenames(all.map((i) => ({ name: i.file.name, lastModified: i.file.lastModified, width: i.width, height: i.height })), s.rule)[index].newName;
  const { stem } = splitName(item.file.name);
  return `${stem}.${EXT[outFormat(s, item.file)]}`;
}

/** One file through the chosen operation. Originals are only read, never changed. */
async function processOne(s: Settings, item: Item, name: string): Promise<File> {
  if (s.op === 'rename') {
    let bytes: Uint8Array | Blob = item.file;
    if (s.strip) {
      const stripped = stripMetadata(new Uint8Array(await item.file.arrayBuffer()));
      if (stripped) bytes = stripped;
      else throw new Error('Details couldn’t be removed from this file without re-encoding it. Use Convert instead.');
    }
    return new File([bytes as BlobPart], name, { type: item.file.type, lastModified: item.file.lastModified });
  }
  const { budget } = canvasBudget();
  const d = await decodeFile(item.file, item.file.name, budget);
  let c = canvasFromSource(d.bitmap, d.width, d.height);
  d.bitmap.close();
  try {
    if (s.op === 'resize') {
      const fit = planFit(c.width, c.height, s.longEdge, s.longEdge);
      if (fit.w !== c.width || fit.h !== c.height) {
        const r = resizeCanvas(c, fit.w, fit.h);
        freeCanvas(c);
        c = r;
      }
    }
    const fmt = outFormat(s, item.file);
    const px = readPixels(c);
    const res =
      s.op === 'compress' && s.bySize
        ? await encodeToSize(px, fmt, s.targetKB * 1000)
        : await encodeImage(px, { format: fmt, quality: s.op === 'resize' ? 90 : s.quality });
    return new File([res.bytes as BlobPart], name, { type: MIME[fmt], lastModified: Date.now() });
  } finally {
    freeCanvas(c);
  }
}

/**
 * Many photos at once: compress, resize, convert or rename. Shows the results before anything
 * is made, runs one photo at a time with Cancel, and hands back new files (Share or a ZIP).
 * Nothing is overwritten. Undo discards the last run and puts the settings back.
 */
export function Batch() {
  const [items, setItems] = useState<Item[]>([]);
  const [s, setS] = useState<Settings>({
    op: 'compress',
    format: 'same',
    quality: settings.value.exportQuality,
    bySize: false,
    targetKB: 500,
    longEdge: 2048,
    rule: { pattern: '{name}', start: 1, padding: 3 },
    strip: true,
  });
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [outputs, setOutputs] = useState<Output[] | null>(null);
  const [sample, setSample] = useState<{ key: string; size: number } | null>(null);
  const cancel = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const before = useRef<Settings | null>(null);
  const patch = (p: Partial<Settings>) => setS((x) => ({ ...x, ...p }));

  // Thumbnails and sizes, one at a time in the background.
  useEffect(() => {
    let alive = true;
    (async () => {
      for (const it of items) {
        if (!alive) return;
        if (it.thumb) continue;
        try {
          const bmp = await createImageBitmap(it.file, { imageOrientation: 'from-image' });
          const t = thumbnail(bmp, 120);
          it.width = bmp.width;
          it.height = bmp.height;
          bmp.close();
          it.thumb = URL.createObjectURL(await canvasToBlob(t, 'image/jpeg', 0.8));
          freeCanvas(t);
        } catch {
          it.thumb = '';
        }
        if (alive) setItems((list) => [...list]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [items.length]);

  useEffect(() => () => items.forEach((i) => i.thumb && URL.revokeObjectURL(i.thumb)), []);

  const names = useMemo(() => items.map((it, i) => outName(s, it, i, items)), [items, s]);
  const renameProblems = useMemo(
    () => (s.op === 'rename' ? previewRenames(items.map((i) => ({ name: i.file.name, lastModified: i.file.lastModified, width: i.width, height: i.height })), s.rule) : []),
    [items, s],
  );
  const blocked = s.op === 'rename' && renameProblems.some((r) => r.problem);

  // A real result for the first photo, so the preview shows true sizes.
  useEffect(() => {
    if (!items.length || running || outputs || s.op === 'rename') return;
    const key = JSON.stringify([items[0].id, s]);
    if (sample?.key === key) return;
    const t = setTimeout(async () => {
      try {
        const f = await processOne(s, items[0], names[0]);
        setSample({ key, size: f.size });
      } catch {
        setSample(null);
      }
    }, 600);
    return () => clearTimeout(t);
  }, [items, s, running, outputs]);

  const add = (files: File[]) => {
    const imgs = files.filter((f) => !f.type || f.type.startsWith('image/'));
    const next = naturalSort([...items, ...imgs.map((file) => ({ id: ++itemSeq, file }))], (i) => i.file.name);
    setItems(next);
    setOutputs(null);
  };

  const run = async () => {
    before.current = s;
    cancel.current = false;
    setRunning(true);
    setDone(0);
    const out: Output[] = [];
    const taken = new Set<string>();
    for (let i = 0; i < items.length; i++) {
      if (cancel.current) break;
      const name = uniqueName(names[i], taken);
      taken.add(name.toLowerCase());
      try {
        out.push({ item: items[i], file: await processOne(s, items[i], name) });
      } catch (e) {
        out.push({ item: items[i], error: e instanceof Error ? e.message : 'Couldn’t be processed.' });
      }
      setDone(i + 1);
    }
    setRunning(false);
    setOutputs(out);
    if (cancel.current) showToast({ icon: 'stack', title: `Stopped after ${out.length} of ${items.length}`, duration: 2600 });
  };

  const files = (outputs ?? []).filter((o) => o.file).map((o) => o.file!);
  const totalIn = (outputs ?? []).reduce((n, o) => n + (o.file ? o.item.file.size : 0), 0);
  const totalOut = files.reduce((n, f) => n + f.size, 0);

  const shareAll = () => {
    if (!files.length) return;
    shareFiles(files, 'PicKit').then(
      (r) => {
        if (r === 'unsupported') void saveZip();
      },
      () => showToast({ icon: 'share', title: 'Couldn’t share them all', subtitle: 'Try Save as ZIP.', duration: 3000 }),
    );
  };

  const saveZip = async () => {
    const entries = await Promise.all(files.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()), modified: new Date(f.lastModified) })));
    const zip = new File([makeZip(entries)], `PicKit ${new Date().toISOString().slice(0, 10)}.zip`, { type: 'application/zip' });
    if (canShareFiles([zip])) void shareFiles([zip], zip.name).catch(() => downloadFile(zip, zip.name));
    else downloadFile(zip, zip.name);
  };

  const undo = async () => {
    const r = await showAlert('Undo this batch?', 'The new files are discarded and the settings go back to how they were. Your originals were never changed.', [
      { label: 'Cancel', style: 'cancel' },
      { label: 'Undo', style: 'destructive' },
    ]);
    if (r !== 'Undo') return;
    setOutputs(null);
    if (before.current) setS(before.current);
  };

  const opNote: Record<Op, string> = {
    compress: 'Smaller files. Location and camera info are removed.',
    resize: 'Shrinks so the longer side fits. Never enlarges. Keeps each file’s format.',
    convert: 'Changes the format. Location and camera info are removed.',
    rename: 'New names only: the pictures aren’t re-encoded.',
  };

  return (
    <NavScreen title="Batch" onBack={popScreen} id="batch">
      <div class="list">
        {!items.length && (
          <div class="empty-state">
            <Icon name="stack" />
            <h2 class="t-title3 t-emph">Many Photos at Once</h2>
            <p class="t-subheadline t-secondary">Compress, resize, convert or rename a whole selection. You see the results first, and nothing is overwritten.</p>
            <Button variant="filled" large icon="photo" label="Choose Photos" onClick={() => input.current?.click()} />
          </div>
        )}

        {items.length > 0 && !outputs && (
          <>
            <Section header="Operation" footer={opNote[s.op]}>
              <Row title="" stacked>
                <Segmented<Op>
                  label="Operation"
                  value={s.op}
                  onChange={(op) => patch({ op })}
                  options={[
                    { value: 'compress', label: 'Compress' },
                    { value: 'resize', label: 'Resize' },
                    { value: 'convert', label: 'Convert' },
                    { value: 'rename', label: 'Rename' },
                  ]}
                />
              </Row>
            </Section>

            {(s.op === 'compress' || s.op === 'convert') && (
              <Section header="Format">
                <Row title="" stacked>
                  <Segmented<OutFormat>
                    label="Format"
                    value={s.format}
                    onChange={(format) => patch({ format })}
                    options={[
                      { value: 'same', label: 'Same' },
                      { value: 'jpeg', label: 'JPEG' },
                      { value: 'png', label: 'PNG' },
                      { value: 'webp', label: 'WebP' },
                    ]}
                  />
                </Row>
                {s.op === 'compress' && <Row title="Fit to a File Size" accessory={<Switch checked={s.bySize} onChange={(bySize) => patch({ bySize })} label="Fit to a file size" />} />}
                {s.op === 'compress' && s.bySize ? (
                  <Row title="At Most" detail={<span class="t-num">{s.targetKB >= 1000 ? `${s.targetKB / 1000} MB` : `${s.targetKB} KB`}</span>} stacked>
                    <Slider value={s.targetKB} min={100} max={5000} step={50} onChange={(targetKB) => patch({ targetKB })} label="Target size" valueText={(v) => `${v} kilobytes`} />
                  </Row>
                ) : (
                  <Row title="Quality" detail={<span class="t-num">{s.quality}%</span>} stacked>
                    <Slider value={s.quality} min={10} max={100} onChange={(quality) => patch({ quality })} label="Quality" valueText={(v) => `${v} percent`} />
                  </Row>
                )}
              </Section>
            )}

            {s.op === 'resize' && (
              <Section header="Longest Side">
                <Row title="Pixels" detail={<span class="t-num">{s.longEdge}</span>} stacked>
                  <div class="chip-row flat">
                    {[1080, 1600, 2048, 3000, 4096].map((v) => (
                      <button type="button" role="radio" aria-checked={s.longEdge === v} class="chip" onClick={() => patch({ longEdge: v })}>
                        {v}
                      </button>
                    ))}
                  </div>
                </Row>
              </Section>
            )}

            {s.op === 'rename' && (
              <Section header="Name Pattern" footer="Tokens: {name} original name, {number} counter, {date} date of the file, {width} and {height}.">
                <Row title="" stacked>
                  <input
                    class="list-input"
                    type="text"
                    value={s.rule.pattern}
                    autocomplete="off"
                    autocapitalize="off"
                    spellcheck={false}
                    aria-label="Name pattern"
                    onInput={(e) => patch({ rule: { ...s.rule, pattern: (e.currentTarget as HTMLInputElement).value } })}
                  />
                  <div class="chip-row flat">
                    {['{name}', '{name}-{number}', 'Photo {number}', '{date} {number}'].map((p) => (
                      <button type="button" class="chip" onClick={() => patch({ rule: { ...s.rule, pattern: p } })}>
                        {p}
                      </button>
                    ))}
                  </div>
                </Row>
                <Row title="Start At" detail={<span class="t-num">{s.rule.start}</span>} stacked>
                  <Slider value={s.rule.start} min={0} max={100} onChange={(start) => patch({ rule: { ...s.rule, start } })} label="Start number" />
                </Row>
                <Row title="Digits" detail={<span class="t-num">{s.rule.padding}</span>} stacked>
                  <Slider value={s.rule.padding} min={1} max={6} onChange={(padding) => patch({ rule: { ...s.rule, padding } })} label="Digits" />
                </Row>
                <Row title="Remove Location & Camera Info" accessory={<Switch checked={s.strip} onChange={(strip) => patch({ strip })} label="Remove location and camera info" />} />
              </Section>
            )}

            <Section header={`Preview · ${items.length} photo${items.length === 1 ? '' : 's'}`} footer={sample && s.op !== 'rename' ? `The first photo comes out at ${formatBytes(sample.size)}.` : undefined}>
              {items.map((it, i) => {
                const fit = s.op === 'resize' && it.width && it.height ? planFit(it.width, it.height, s.longEdge, s.longEdge) : null;
                const problem = renameProblems[i]?.problem;
                return (
                  <div class="row batch-row">
                    {it.thumb ? <img class="batch-thumb" src={it.thumb} alt="" /> : <span class="batch-thumb" />}
                    <span class="row-text">
                      <span class="row-title batch-name">{names[i]}</span>
                      <span class={`row-subtitle${problem ? ' batch-problem' : ''}`}>
                        {problem ??
                          `${it.file.name !== names[i] ? `from ${it.file.name} · ` : ''}${fit ? `${fit.w} × ${fit.h}` : it.width ? `${it.width} × ${it.height}` : ''} · ${formatBytes(it.file.size)}`}
                      </span>
                    </span>
                    <button
                      type="button"
                      class="batch-remove"
                      aria-label={`Remove ${it.file.name}`}
                      disabled={running}
                      onClick={() => setItems(items.filter((x) => x !== it))}
                    >
                      <Icon name="minus-circle" />
                    </button>
                  </div>
                );
              })}
              <Row title="Add Photos" tinted onClick={running ? undefined : () => input.current?.click()} />
            </Section>

            <div class="batch-run">
              {running ? (
                <>
                  <div class="progress" role="progressbar" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={done}>
                    <span style={{ width: `${(done / items.length) * 100}%` }} />
                  </div>
                  <p class="t-footnote t-secondary t-num">
                    {done} of {items.length}
                  </p>
                  <Button variant="gray" large label="Cancel" onClick={() => (cancel.current = true)} />
                </>
              ) : (
                <Button
                  variant="filled"
                  large
                  label={`${s.op === 'rename' ? 'Rename' : s.op[0].toUpperCase() + s.op.slice(1)} ${items.length} Photo${items.length === 1 ? '' : 's'}`}
                  disabled={blocked || !items.length}
                  onClick={() => void run()}
                />
              )}
              {blocked && <p class="t-footnote batch-problem">Some names have problems, so nothing will be made until they’re fixed.</p>}
            </div>
          </>
        )}

        {outputs && (
          <>
            <Section
              header="Done"
              footer={s.op !== 'rename' && totalIn ? `${formatBytes(totalIn)} → ${formatBytes(totalOut)} (${Math.round((1 - totalOut / totalIn) * 100)}% smaller).` : undefined}
            >
              {outputs.map((o) => (
                <Row
                  title={<span class="batch-name">{o.file?.name ?? o.item.file.name}</span>}
                  subtitle={o.error ? <span class="batch-problem">{o.error}</span> : `${formatBytes(o.item.file.size)} → ${formatBytes(o.file!.size)}`}
                />
              ))}
            </Section>
            <div class="batch-run">
              <Button variant="filled" large icon="share" label={`Share ${files.length} File${files.length === 1 ? '' : 's'}`} disabled={!files.length} onClick={shareAll} />
              <div class="button-row">
                <Button variant="gray" icon="zip" label="Save as ZIP" disabled={!files.length} onClick={() => void saveZip()} />
                <Button variant="gray" icon="undo" label="Undo" onClick={() => void undo()} />
              </div>
              <Button
                variant="plain"
                label="Start Over"
                onClick={() => {
                  items.forEach((i) => i.thumb && URL.revokeObjectURL(i.thumb));
                  setItems([]);
                  setOutputs(null);
                }}
              />
            </div>
          </>
        )}
      </div>
      <input
        ref={input}
        class="visually-hidden"
        type="file"
        accept="image/*"
        multiple
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const el = e.currentTarget;
          const files = [...(el.files ?? [])];
          el.value = '';
          if (files.length) add(files);
        }}
      />
    </NavScreen>
  );
}
