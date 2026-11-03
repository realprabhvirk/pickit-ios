import type { Pixels } from './ops';
import type { Rect } from './geometry';
import type { MarkupEl } from './markup';
import { deleteItem, getItem, setItem } from '../store/db';
import { isIOS } from '../app/env';

/**
 * Undo that stores only what changed, after PicKit for Windows (Documents/EditHistory.cs):
 * each step holds whichever state is *not* on show, and undo and redo are the same exchange,
 * so a step can't drift out of sync with its document.
 *
 *  - region: pixels of one rectangle (blur, redact, a brush stroke)
 *  - raster: the whole picture plus markup (crop, resize, rotate: the size changes)
 *  - markup: only the vector list (cheap)
 *
 * When steps take more memory than the budget, the oldest pixels move to IndexedDB instead
 * of being thrown away, and come back on demand.
 */
export interface Slot {
  mem?: Pixels;
  key?: string;
  width: number;
  height: number;
}

export type Step =
  | { kind: 'region'; label: string; rect: Rect; px: Slot }
  | { kind: 'raster'; label: string; px: Slot; markup: MarkupEl[]; alpha: boolean }
  | { kind: 'markup'; label: string; markup: MarkupEl[] };

export interface Exchangeable {
  /** Read the region now on show. */
  readRegion(r: Rect): Pixels;
  writeRegion(r: Rect, p: Pixels): void;
  /** Replace the whole picture; returns what was there. */
  swapRaster(p: Pixels, alpha: boolean): { px: Pixels; alpha: boolean };
  markup: MarkupEl[];
}

const MAX_STEPS = 60;
const MEMORY_BUDGET = (isIOS() ? 160 : 600) * 1024 * 1024;
let spillSeq = 0;

const slotBytes = (s: Slot) => (s.mem ? s.mem.data.byteLength : 0);
const makeSlot = (p: Pixels): Slot => ({ mem: p, width: p.width, height: p.height });

async function load(s: Slot): Promise<Pixels> {
  if (s.mem) return s.mem;
  if (!s.key) throw new Error('Missing undo data');
  const blob = await getItem<Blob>(s.key, 'spill');
  if (!blob) throw new Error('Undo data was cleared');
  const data = new Uint8ClampedArray(await blob.arrayBuffer());
  return { data, width: s.width, height: s.height };
}

async function release(s: Slot) {
  if (s.key) await deleteItem(s.key, 'spill');
  s.mem = undefined;
  s.key = undefined;
}

function stepSlot(step: Step): Slot | null {
  return step.kind === 'markup' ? null : step.px;
}

export class History {
  undoStack: Step[] = [];
  redoStack: Step[] = [];
  private busy = false;
  onChange?: () => void;
  /** Steps that couldn't be kept (storage refused); shown so it's never a silent loss. */
  dropped = 0;

  get canUndo() {
    return this.undoStack.length > 0 && !this.busy;
  }
  get canRedo() {
    return this.redoStack.length > 0 && !this.busy;
  }
  get length() {
    return this.undoStack.length;
  }

  regionStep(label: string, rect: Rect, before: Pixels): Step {
    return { kind: 'region', label, rect, px: makeSlot(before) };
  }
  rasterStep(label: string, before: Pixels, markup: MarkupEl[], alpha: boolean): Step {
    return { kind: 'raster', label, px: makeSlot(before), markup, alpha };
  }
  markupStep(label: string, before: MarkupEl[]): Step {
    return { kind: 'markup', label, markup: before };
  }

  push(step: Step) {
    for (const s of this.redoStack) {
      const slot = stepSlot(s);
      if (slot) void release(slot);
    }
    this.redoStack = [];
    this.undoStack.push(step);
    while (this.undoStack.length > MAX_STEPS) {
      const old = this.undoStack.shift()!;
      const slot = stepSlot(old);
      if (slot) void release(slot);
    }
    this.onChange?.();
    void this.spillIfNeeded();
  }

  async undo(doc: Exchangeable) {
    return this.move(this.undoStack, this.redoStack, doc);
  }

  async redo(doc: Exchangeable) {
    return this.move(this.redoStack, this.undoStack, doc);
  }

  /** Undo back to `length` steps, dropping what's undone (Cancel in a tool). */
  async rollback(doc: Exchangeable, length: number) {
    while (this.undoStack.length > length) await this.undo(doc);
    for (const s of this.redoStack) {
      const slot = stepSlot(s);
      if (slot) void release(slot);
    }
    this.redoStack = [];
    this.onChange?.();
  }

  private async move(from: Step[], to: Step[], doc: Exchangeable) {
    if (this.busy || !from.length) return null;
    this.busy = true;
    const step = from.pop()!;
    try {
      await exchange(step, doc);
      to.push(step);
      return step;
    } catch (e) {
      // Storage lost the pixels (cleared by iOS or the user): the step can't be replayed.
      this.dropped++;
      throw e;
    } finally {
      this.busy = false;
      this.onChange?.();
    }
  }

  memoryBytes() {
    let n = 0;
    for (const s of [...this.undoStack, ...this.redoStack]) {
      const slot = stepSlot(s);
      if (slot) n += slotBytes(slot);
    }
    return n;
  }

  /** Move the oldest in-memory pixels to storage until under budget. */
  async spillIfNeeded() {
    let over = this.memoryBytes() - MEMORY_BUDGET;
    if (over <= 0) return;
    for (const s of [...this.undoStack, ...this.redoStack.slice().reverse()]) {
      if (over <= 0) break;
      const slot = stepSlot(s);
      if (!slot?.mem) continue;
      const key = `spill-${Date.now().toString(36)}-${spillSeq++}`;
      const bytes = slot.mem.data.byteLength;
      const ok = await setItem(key, new Blob([slot.mem.data as BlobPart]), 'spill');
      if (ok) {
        slot.key = key;
        slot.mem = undefined;
        over -= bytes;
      } else {
        // No storage: forget the oldest step rather than run out of memory.
        const i = this.undoStack.indexOf(s);
        if (i >= 0) {
          this.undoStack.splice(i, 1);
          this.dropped++;
          slot.mem = undefined;
          over -= bytes;
        }
      }
    }
    this.onChange?.();
  }

  async clear() {
    for (const s of [...this.undoStack, ...this.redoStack]) {
      const slot = stepSlot(s);
      if (slot) await release(slot);
    }
    this.undoStack = [];
    this.redoStack = [];
    this.onChange?.();
  }
}

async function exchange(step: Step, doc: Exchangeable) {
  if (step.kind === 'markup') {
    const cur = doc.markup;
    doc.markup = step.markup;
    step.markup = cur;
    return;
  }
  const px = await load(step.px);
  if (step.px.key) await deleteItem(step.px.key, 'spill');
  if (step.kind === 'region') {
    const cur = doc.readRegion(step.rect);
    doc.writeRegion(step.rect, px);
    step.px = makeSlot(cur);
    return;
  }
  const prevMarkup = doc.markup;
  const prev = doc.swapRaster(px, step.alpha);
  doc.markup = step.markup;
  step.markup = prevMarkup;
  step.alpha = prev.alpha;
  step.px = makeSlot(prev.px);
}
