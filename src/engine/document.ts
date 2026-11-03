import { signal } from '@preact/signals';
import { History, type Step } from './history';
import type { DecodedImage, SniffedFormat } from './decode';
import type { PhotoMetadata } from './metadata';
import type { Rect } from './geometry';
import type { MarkupEl } from './markup';
import type { Pixels } from './ops';
import { canvasFromPixels, canvasFromSource, freeCanvas, readPixels, writePixels } from './raster';

let docSeq = 0;

/**
 * One open photo: its working pixels, vector markup and undo history. The original file is
 * kept, untouched, for metadata and for exports that keep camera details.
 */
export class Doc {
  readonly id: string;
  name: string;
  /** The file as picked. Never modified. */
  readonly original: Blob | null;
  readonly format: SniffedFormat;
  readonly originalBytes: number;
  readonly originalWidth: number;
  readonly originalHeight: number;
  readonly reduced: boolean;
  meta: PhotoMetadata | null = null;
  raster: HTMLCanvasElement;
  markup: MarkupEl[] = [];
  hasAlpha = false;
  readonly history = new History();
  /** Bumps on every change, for anything that re-renders. */
  readonly version = signal(0);
  /** Bumps when pixels change (the view rebuilds its copies, autosave re-encodes). */
  rasterVersion = 0;
  /** Edited since it was last exported or opened. */
  dirty = false;
  createdAt = Date.now();

  constructor(init: {
    id?: string;
    name: string;
    original: Blob | null;
    format: SniffedFormat;
    originalBytes: number;
    originalWidth: number;
    originalHeight: number;
    reduced: boolean;
    raster: HTMLCanvasElement;
  }) {
    this.id = init.id ?? `d${Date.now().toString(36)}${(docSeq++).toString(36)}`;
    this.name = init.name;
    this.original = init.original;
    this.format = init.format;
    this.originalBytes = init.originalBytes;
    this.originalWidth = init.originalWidth;
    this.originalHeight = init.originalHeight;
    this.reduced = init.reduced;
    this.raster = init.raster;
    this.history.onChange = () => this.touch(false);
  }

  static fromDecoded(d: DecodedImage, original: Blob | null): Doc {
    const raster = canvasFromSource(d.bitmap, d.width, d.height);
    d.bitmap.close();
    return new Doc({
      name: d.name,
      original,
      format: d.format,
      originalBytes: d.bytes,
      originalWidth: d.originalWidth,
      originalHeight: d.originalHeight,
      reduced: d.reduced,
      raster,
    });
  }

  get width() {
    return this.raster.width;
  }
  get height() {
    return this.raster.height;
  }

  touch(pixels: boolean) {
    if (pixels) this.rasterVersion++;
    this.version.value++;
  }

  /** Record an edit: the step holds what was there before. */
  commit(step: Step) {
    this.history.push(step);
    this.dirty = true;
    this.touch(step.kind !== 'markup');
  }

  // Exchangeable, for History
  readRegion(r: Rect): Pixels {
    return readPixels(this.raster, r);
  }
  writeRegion(r: Rect, p: Pixels) {
    writePixels(this.raster, p, r.x, r.y);
  }
  swapRaster(p: Pixels, alpha: boolean) {
    const prev = { px: readPixels(this.raster), alpha: this.hasAlpha };
    const old = this.raster;
    this.raster = canvasFromPixels(p);
    this.hasAlpha = alpha;
    freeCanvas(old);
    return prev;
  }

  /** Replace the whole picture as one undoable step (crop, resize, rotate...). */
  replaceRaster(label: string, next: HTMLCanvasElement, nextMarkup: MarkupEl[], nextAlpha = this.hasAlpha) {
    const before = readPixels(this.raster);
    const step = this.history.rasterStep(label, before, this.markup, this.hasAlpha);
    const old = this.raster;
    this.raster = next;
    this.markup = nextMarkup;
    this.hasAlpha = nextAlpha;
    if (old !== next) freeCanvas(old);
    this.commit(step);
  }

  /** Change the vector markup as one undoable step. */
  setMarkup(label: string, next: MarkupEl[]) {
    const step = this.history.markupStep(label, this.markup);
    this.markup = next;
    this.commit(step);
  }

  async undo() {
    const s = await this.history.undo(this);
    if (s) {
      this.dirty = true;
      this.touch(s.kind !== 'markup');
    }
    return s;
  }

  async redo() {
    const s = await this.history.redo(this);
    if (s) {
      this.dirty = true;
      this.touch(s.kind !== 'markup');
    }
    return s;
  }

  dispose() {
    void this.history.clear();
    freeCanvas(this.raster);
  }
}
