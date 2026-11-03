import { effect, signal } from '@preact/signals';
import { Doc } from '../engine/document';
import type { MarkupEl } from '../engine/markup';
import type { PhotoMetadata } from '../engine/metadata';
import type { SniffedFormat } from '../engine/decode';
import { canvasFromSource, canvasToBlob, freeCanvas, thumbnail } from '../engine/raster';
import { clearStore, deleteItem, getItem, keys, setItem } from '../store/db';
import { activeId, addDocs, docs } from './docs';

/**
 * Autosave. iOS can close a Home Screen app at any moment, so the open photos (their current
 * pixels, markup, names) and the tool in use are written to IndexedDB after each edit settles,
 * when the app goes to the background, and every so often. On the next launch the picker
 * offers Resume.
 *
 * Undo history isn't saved: it can be hundreds of megabytes. A resumed photo starts with a
 * fresh history.
 */
interface DocRecord {
  id: string;
  name: string;
  format: SniffedFormat;
  originalBytes: number;
  originalWidth: number;
  originalHeight: number;
  reduced: boolean;
  hasAlpha: boolean;
  markup: MarkupEl[];
  meta: PhotoMetadata | null;
  raster: Blob;
  original: Blob | null;
  thumb: Blob;
  dirty: boolean;
  savedAt: number;
}

export interface SessionIndex {
  ids: string[];
  activeId: string | null;
  tool: string | null;
  savedAt: number;
}

export interface SessionSummary {
  index: SessionIndex;
  thumbs: { id: string; name: string; url: string }[];
}

export const savedSession = signal<SessionSummary | null>(null);
export const currentTool = signal<string | null>(null);

const lastRaster = new Map<string, { version: number; raster: Blob; thumb: Blob }>();
const timers = new Map<string, number>();
let started = false;

async function saveDoc(doc: Doc) {
  let cached = lastRaster.get(doc.id);
  if (!cached || cached.version !== doc.rasterVersion) {
    const version = doc.rasterVersion;
    const raster = await canvasToBlob(doc.raster, 'image/png');
    const t = thumbnail(doc.raster, 320);
    const thumb = await canvasToBlob(t, 'image/jpeg', 0.8);
    freeCanvas(t);
    cached = { version, raster, thumb };
    lastRaster.set(doc.id, cached);
  }
  if (!docs.value.includes(doc)) return; // closed meanwhile
  const rec: DocRecord = {
    id: doc.id,
    name: doc.name,
    format: doc.format,
    originalBytes: doc.originalBytes,
    originalWidth: doc.originalWidth,
    originalHeight: doc.originalHeight,
    reduced: doc.reduced,
    hasAlpha: doc.hasAlpha,
    markup: doc.markup,
    meta: doc.meta,
    raster: cached.raster,
    original: doc.original,
    thumb: cached.thumb,
    dirty: doc.dirty,
    savedAt: Date.now(),
  };
  await setItem(doc.id, rec, 'docs');
}

async function saveIndex() {
  // Until the person resumes or discards last time's photos, leave them alone.
  if (savedSession.value) return;
  const index: SessionIndex = { ids: docs.value.map((d) => d.id), activeId: activeId.value, tool: currentTool.value, savedAt: Date.now() };
  await setItem('session', index);
  // Forget photos that were closed.
  const live = new Set(index.ids);
  for (const k of await keys('docs')) if (!live.has(k)) await deleteItem(k, 'docs');
}

export function scheduleSave(doc: Doc, delay = 1200) {
  clearTimeout(timers.get(doc.id));
  timers.set(
    doc.id,
    window.setTimeout(() => {
      timers.delete(doc.id);
      void saveDoc(doc).catch(() => {});
    }, delay),
  );
}

/** Write everything now (going to the background). Raster encodes may not finish if iOS suspends us; the last good save stays. */
export function flush() {
  for (const [id, t] of timers) {
    clearTimeout(t);
    timers.delete(id);
    const d = docs.value.find((x) => x.id === id);
    if (d) void saveDoc(d).catch(() => {});
  }
  void saveIndex();
}

/** Starts watching the open photos. */
export function startAutosave() {
  if (started) return;
  started = true;
  const seen = new Map<string, number>();
  effect(() => {
    const list = docs.value;
    void activeId.value;
    void currentTool.value;
    for (const d of list) {
      const v = d.version.value;
      if (seen.get(d.id) !== v) {
        seen.set(d.id, v);
        scheduleSave(d);
      }
    }
    void saveIndex();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  window.addEventListener('pagehide', flush);
  setInterval(() => {
    if (timers.size) flush();
  }, 20_000);
}

/** What the picker shows as Resume, if anything was left open last time. */
export async function loadSessionSummary(): Promise<SessionSummary | null> {
  const index = await getItem<SessionIndex>('session');
  if (!index?.ids?.length) return (savedSession.value = null);
  const thumbs: SessionSummary['thumbs'] = [];
  for (const id of index.ids) {
    const rec = await getItem<DocRecord>(id, 'docs');
    if (rec?.thumb) thumbs.push({ id, name: rec.name, url: URL.createObjectURL(rec.thumb) });
  }
  if (!thumbs.length) return (savedSession.value = null);
  return (savedSession.value = { index, thumbs });
}

/** Re-open the saved photos. Returns the tool that was open, if any. */
export async function resumeSession(): Promise<string | null> {
  const s = savedSession.value;
  if (!s) return null;
  const restored: Doc[] = [];
  for (const id of s.index.ids) {
    const rec = await getItem<DocRecord>(id, 'docs');
    if (!rec?.raster) continue;
    try {
      const bmp = await createImageBitmap(rec.raster);
      const raster = canvasFromSource(bmp, bmp.width, bmp.height);
      bmp.close();
      const doc = new Doc({
        id: rec.id,
        name: rec.name,
        original: rec.original,
        format: rec.format,
        originalBytes: rec.originalBytes,
        originalWidth: rec.originalWidth,
        originalHeight: rec.originalHeight,
        reduced: rec.reduced,
        raster,
      });
      doc.markup = rec.markup ?? [];
      doc.meta = rec.meta;
      doc.hasAlpha = rec.hasAlpha;
      doc.dirty = rec.dirty;
      lastRaster.set(doc.id, { version: doc.rasterVersion, raster: rec.raster, thumb: rec.thumb });
      restored.push(doc);
    } catch {
      /* a damaged save is skipped */
    }
  }
  for (const t of s.thumbs) URL.revokeObjectURL(t.url);
  savedSession.value = null;
  if (!restored.length) return null;
  const active = restored.find((d) => d.id === s.index.activeId)?.id;
  addDocs(restored, active);
  return s.index.tool;
}

export async function discardSession() {
  const s = savedSession.value;
  if (s) for (const t of s.thumbs) URL.revokeObjectURL(t.url);
  savedSession.value = null;
  lastRaster.clear();
  await setItem('session', { ids: [], activeId: null, tool: null, savedAt: Date.now() });
  await clearStore('docs');
}
