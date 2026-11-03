/// <reference lib="webworker" />
/**
 * Heavy pixel work, off the main thread so gestures stay smooth: encoding (WASM), target-size
 * search, blur and pixelate. Messages carry transferable buffers, never copies.
 */
import { boxBlur, encode, encodeToTarget, pixelate, resizePixels, type EncodeOptions, type Format, type Pixels } from './ops';

type Req =
  | { id: number; op: 'encode'; px: Pixels; opts: EncodeOptions }
  | { id: number; op: 'target'; px: Pixels; format: Format; target: number; optimise?: boolean }
  | { id: number; op: 'blur'; px: Pixels; radius: number }
  | { id: number; op: 'pixelate'; px: Pixels; block: number; ox: number; oy: number }
  | { id: number; op: 'resize'; px: Pixels; w: number; h: number };

const post = (msg: unknown, transfer: Transferable[] = []) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, transfer);

self.onmessage = async (e: MessageEvent<Req>) => {
  const r = e.data;
  try {
    switch (r.op) {
      case 'encode': {
        const bytes = await encode(r.px, r.opts);
        post({ id: r.id, ok: true, result: { bytes, width: r.px.width, height: r.px.height, quality: r.opts.quality, met: true } }, [bytes.buffer]);
        break;
      }
      case 'target': {
        const res = await encodeToTarget(r.px, r.format, r.target, (p, q) => encode(p, { format: r.format, quality: q, optimise: r.optimise }), (f) =>
          post({ id: r.id, progress: f }),
        );
        post({ id: r.id, ok: true, result: res }, [res.bytes.buffer]);
        break;
      }
      case 'blur': {
        const out = boxBlur(r.px, r.radius);
        post({ id: r.id, ok: true, result: out }, [out.data.buffer]);
        break;
      }
      case 'pixelate': {
        const out = pixelate(r.px, r.block, r.ox, r.oy);
        post({ id: r.id, ok: true, result: out }, [out.data.buffer]);
        break;
      }
      case 'resize': {
        const out = resizePixels(r.px, r.w, r.h);
        post({ id: r.id, ok: true, result: out }, [out.data.buffer]);
        break;
      }
    }
  } catch (err) {
    post({ id: r.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
