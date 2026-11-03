import type { EncodeOptions, EncodeResult, Format, Pixels } from './ops';

/**
 * Talks to engine.worker.ts. Falls back to running the same code on the main thread (in small
 * slices of time) if a worker can't start, so nothing is lost on odd browsers, just smoothness.
 */
let worker: Worker | null = null;
let failed = false;
let seq = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; progress?: (f: number) => void }>();

function getWorker(): Worker | null {
  if (failed) return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const m = e.data as { id: number; ok?: boolean; result?: unknown; error?: string; progress?: number };
      const p = pending.get(m.id);
      if (!p) return;
      if (m.progress !== undefined) return p.progress?.(m.progress);
      pending.delete(m.id);
      if (m.ok) p.resolve(m.result);
      else p.reject(new Error(m.error ?? 'Worker error'));
    };
    worker.onerror = () => {
      failed = true;
      for (const [, p] of pending) p.reject(new Error('Worker failed'));
      pending.clear();
      worker = null;
    };
    return worker;
  } catch {
    failed = true;
    return null;
  }
}

function call<T>(msg: Record<string, unknown>, transfer: Transferable[], progress?: (f: number) => void): Promise<T> {
  const w = getWorker();
  if (!w) return Promise.reject(new Error('no-worker'));
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, progress });
    w.postMessage({ ...msg, id }, transfer);
  });
}

/** Copy pixels so the caller's buffer survives being transferred. */
export const clonePixels = (p: Pixels): Pixels => ({ data: new Uint8ClampedArray(p.data), width: p.width, height: p.height });

async function local() {
  return import('./ops');
}

export async function encodeImage(px: Pixels, opts: EncodeOptions): Promise<EncodeResult> {
  try {
    return await call<EncodeResult>({ op: 'encode', px, opts }, [px.data.buffer]);
  } catch (e) {
    if ((e as Error).message !== 'no-worker' && !failed) throw e;
    const ops = await local();
    const bytes = await ops.encode(px, opts);
    return { bytes, width: px.width, height: px.height, quality: opts.quality, met: true };
  }
}

export async function encodeToSize(px: Pixels, format: Format, target: number, optimise = false, progress?: (f: number) => void): Promise<EncodeResult> {
  try {
    return await call<EncodeResult>({ op: 'target', px, format, target, optimise }, [px.data.buffer], progress);
  } catch (e) {
    if ((e as Error).message !== 'no-worker' && !failed) throw e;
    const ops = await local();
    return ops.encodeToTarget(px, format, target, (p, q) => ops.encode(p, { format, quality: q, optimise }), progress);
  }
}

export async function blurPixels(px: Pixels, radius: number): Promise<Pixels> {
  try {
    return await call<Pixels>({ op: 'blur', px, radius }, [px.data.buffer]);
  } catch (e) {
    if ((e as Error).message !== 'no-worker' && !failed) throw e;
    return (await local()).boxBlur(px, radius);
  }
}

export async function pixelatePixels(px: Pixels, block: number, ox: number, oy: number): Promise<Pixels> {
  try {
    return await call<Pixels>({ op: 'pixelate', px, block, ox, oy }, [px.data.buffer]);
  } catch (e) {
    if ((e as Error).message !== 'no-worker' && !failed) throw e;
    return (await local()).pixelate(px, block, ox, oy);
  }
}

export async function resizeInWorker(px: Pixels, w: number, h: number): Promise<Pixels> {
  try {
    return await call<Pixels>({ op: 'resize', px, w, h }, [px.data.buffer]);
  } catch (e) {
    if ((e as Error).message !== 'no-worker' && !failed) throw e;
    return (await local()).resizePixels(px, w, h);
  }
}
