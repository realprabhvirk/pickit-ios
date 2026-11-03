import { computed, signal } from '@preact/signals';
import { Doc } from '../engine/document';
import { decodeFile, ImageOpenError } from '../engine/decode';
import { canvasBudget } from '../engine/probe';
import { readMetadata } from '../engine/metadata';
import { isIOS } from './env';

/** Every photo open in the editor, each with its own edits and undo. */
export const docs = signal<Doc[]>([]);
export const activeId = signal<string | null>(null);
export const activeDoc = computed(() => docs.value.find((d) => d.id === activeId.value) ?? null);

/** Open photos share the page's canvas memory; past this, iOS may close the app. */
const OPEN_PIXEL_BUDGET = (isIOS() ? 64 : 400) * 1_000_000;

export function openPixels() {
  return docs.value.reduce((n, d) => n + d.width * d.height, 0);
}

export interface OpenResult {
  opened: Doc[];
  failed: { name: string; reason: string }[];
  skipped: number;
}

/** Decodes files into documents. Damaged files are reported, never fatal. */
export async function openFiles(files: (File | Blob)[]): Promise<OpenResult> {
  const result: OpenResult = { opened: [], failed: [], skipped: 0 };
  const { budget } = canvasBudget();
  for (const file of files) {
    const name = file instanceof File && file.name ? file.name : 'Pasted Image.png';
    if (openPixels() + result.opened.reduce((n, d) => n + d.width * d.height, 0) > OPEN_PIXEL_BUDGET) {
      result.skipped++;
      continue;
    }
    try {
      const decoded = await decodeFile(file, name, budget);
      const doc = Doc.fromDecoded(decoded, file);
      try {
        doc.meta = readMetadata(new Uint8Array(await file.slice(0, 8 * 1024 * 1024).arrayBuffer()));
      } catch {
        doc.meta = null;
      }
      result.opened.push(doc);
    } catch (e) {
      result.failed.push({ name, reason: e instanceof ImageOpenError ? (e.detail ?? e.message) : 'It may be damaged or in a format this iPhone can’t read.' });
    }
  }
  if (result.opened.length) {
    docs.value = [...docs.value, ...result.opened];
    activeId.value = result.opened[0].id;
  }
  return result;
}

export function addDocs(list: Doc[], activate?: string) {
  docs.value = [...docs.value, ...list];
  activeId.value = activate ?? list[0]?.id ?? activeId.value;
}

export function closeDoc(id: string) {
  const list = docs.value;
  const i = list.findIndex((d) => d.id === id);
  if (i < 0) return;
  const [doc] = list.splice(i, 1);
  docs.value = [...list];
  if (activeId.value === id) activeId.value = list[Math.min(i, list.length - 1)]?.id ?? null;
  // Give the view a frame to let go of the canvas before it's released.
  requestAnimationFrame(() => doc.dispose());
}

export function closeAll() {
  const list = docs.value;
  docs.value = [];
  activeId.value = null;
  requestAnimationFrame(() => list.forEach((d) => d.dispose()));
}
