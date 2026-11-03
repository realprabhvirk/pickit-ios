/**
 * The WASM encoders (MozJPEG, PNG, OxiPNG, WebP), loaded on demand and precached for offline.
 * Phase 0 only proves they load and run offline under the CSP; Phase 1 moves encoding into a
 * worker and wires it to export.
 *
 * Single-threaded builds only: OxiPNG is imported from its single-thread package directly, so
 * the multi-threaded variant (which needs SharedArrayBuffer and COOP/COEP) is never bundled.
 */
export interface CodecCheck {
  name: 'JPEG' | 'PNG' | 'OxiPNG' | 'WebP';
  ok: boolean;
  bytes?: number;
  error?: string;
  ms?: number;
}

function testImage(): ImageData {
  const w = 16;
  const h = 16;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      data[i] = x * 16;
      data[i + 1] = y * 16;
      data[i + 2] = 128;
      data[i + 3] = 255;
    }
  return new ImageData(data, w, h);
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47];

async function run(name: CodecCheck['name'], fn: () => Promise<ArrayBuffer>, check: (b: Uint8Array) => boolean): Promise<CodecCheck> {
  const t0 = performance.now();
  try {
    const buf = new Uint8Array(await fn());
    if (!check(buf)) return { name, ok: false, error: 'Unexpected output' };
    return { name, ok: true, bytes: buf.byteLength, ms: Math.round(performance.now() - t0) };
  } catch (e) {
    return { name, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function checkCodecs(): Promise<CodecCheck[]> {
  const img = testImage();
  const isPng = (b: Uint8Array) => PNG_SIG.every((v, i) => b[i] === v);
  return Promise.all([
    run(
      'JPEG',
      async () => (await import('@jsquash/jpeg/encode.js')).default(img, { quality: 80 }),
      (b) => b[0] === 0xff && b[1] === 0xd8,
    ),
    run('PNG', async () => (await import('@jsquash/png/encode.js')).default(img), isPng),
    run(
      'OxiPNG',
      async () => {
        const ox = await import('@jsquash/oxipng/codec/pkg/squoosh_oxipng.js');
        await ox.default();
        return ox.optimise_raw(img.data, img.width, img.height, 2, false, true).buffer as ArrayBuffer;
      },
      isPng,
    ),
    run(
      'WebP',
      async () => (await import('@jsquash/webp/encode.js')).default(img, { quality: 80 }),
      (b) => String.fromCharCode(...b.subarray(8, 12)) === 'WEBP',
    ),
  ]);
}
