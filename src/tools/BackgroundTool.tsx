import { useEffect, useRef, useState } from 'preact/hooks';
import type { ToolHost } from './host';
import { createCanvas, ctx2d, freeCanvas } from '../engine/raster';
import { Segmented } from '../ui/Segmented';
import { Slider } from '../ui/Slider';
import { Button } from '../ui/Button';

type Brush = 'remove' | 'keep';

interface Tile {
  x: number;
  y: number;
  data: ImageData;
}

const TILE = 256;

/**
 * Remove a background by hand with Remove and Keep brushes, after PicKit for Windows
 * (Segmentation/MaskEditor.cs). Strokes never touch the photo: they paint a preview whose
 * transparency is the mask, and Keep brings pixels back from the untouched photo, so a Remove
 * stroke painted by mistake can be taken back at any time. Shown over a checkerboard. No AI.
 *
 * Undo saves only the 256 px tiles a stroke touches, not the whole picture.
 */
export function BackgroundTool({ host }: { host: ToolHost }) {
  const { doc, view } = host;
  const [mode, setMode] = useState<Brush>('remove');
  const [size, setSize] = useState(48);
  const [soft, setSoft] = useState(30);
  const [undoCount, setUndoCount] = useState(0);
  const [touched, setTouched] = useState(false);
  const st = useRef({ mode, size, soft });
  st.current = { mode, size, soft };
  const res = useRef<{ preview: HTMLCanvasElement; undo: Tile[][]; stroke: Map<number, Tile> | null; cursor: { x: number; y: number } | null } | null>(null);

  useEffect(() => {
    const preview = createCanvas(doc.width, doc.height);
    ctx2d(preview).drawImage(doc.raster, 0, 0);
    res.current = { preview, undo: [], stroke: null, cursor: null };
    view.transparent = true;
    view.setSource(preview, false);
    return () => {
      const r = res.current;
      res.current = null;
      view.transparent = doc.hasAlpha;
      view.setSource(doc.raster, false);
      if (r && r.preview !== doc.raster) freeCanvas(r.preview);
    };
  }, []);

  /** Save the tiles under a rectangle before the first time this stroke paints them. */
  const capture = (x0: number, y0: number, x1: number, y1: number) => {
    const r = res.current;
    if (!r?.stroke) return;
    const cols = Math.ceil(doc.width / TILE);
    const p = ctx2d(r.preview);
    for (let ty = Math.max(0, Math.floor(y0 / TILE)); ty <= Math.min(Math.ceil(doc.height / TILE) - 1, Math.floor(y1 / TILE)); ty++) {
      for (let tx = Math.max(0, Math.floor(x0 / TILE)); tx <= Math.min(cols - 1, Math.floor(x1 / TILE)); tx++) {
        const key = ty * cols + tx;
        if (r.stroke.has(key)) continue;
        const x = tx * TILE;
        const y = ty * TILE;
        r.stroke.set(key, { x, y, data: p.getImageData(x, y, Math.min(TILE, doc.width - x), Math.min(TILE, doc.height - y)) });
      }
    }
  };

  const dab = (x: number, y: number) => {
    const r = res.current;
    if (!r) return;
    const radius = Math.max(1, (st.current.size / 2) * host.pxPerPt());
    capture(x - radius, y - radius, x + radius, y + radius);
    const hard = Math.max(0.01, Math.min(0.99, 1 - st.current.soft / 100));
    const p = ctx2d(r.preview);
    const grad = (c: CanvasRenderingContext2D, cx: number, cy: number) => {
      const g = c.createRadialGradient(cx, cy, 0, cx, cy, radius);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(hard, 'rgba(0,0,0,1)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      return g;
    };
    if (st.current.mode === 'remove') {
      p.save();
      p.globalCompositeOperation = 'destination-out';
      p.fillStyle = grad(p, x, y);
      p.beginPath();
      p.arc(x, y, radius, 0, Math.PI * 2);
      p.fill();
      p.restore();
    } else {
      // Keep: bring the untouched photo back through a soft round brush.
      const d = Math.ceil(radius * 2);
      const t = createCanvas(d, d);
      const tc = ctx2d(t);
      tc.drawImage(doc.raster, x - radius, y - radius, d, d, 0, 0, d, d);
      tc.globalCompositeOperation = 'destination-in';
      tc.fillStyle = grad(tc, radius, radius);
      tc.fillRect(0, 0, d, d);
      p.drawImage(t, x - radius, y - radius);
      freeCanvas(t);
    }
    view.invalidate(r.preview, { refit: false });
  };

  useEffect(
    () =>
      host.addOverlay((ctx) => {
        const c = res.current?.cursor;
        if (!c) return;
        const radius = (st.current.size / 2) * host.pxPerPt();
        ctx.lineWidth = 1.5 / view.vt.zoom;
        ctx.strokeStyle = st.current.mode === 'remove' ? '#FF453A' : '#30D158';
        ctx.beginPath();
        ctx.arc(c.x, c.y, radius, 0, Math.PI * 2);
        ctx.stroke();
      }),
    [],
  );

  useEffect(() => {
    let last: { x: number; y: number } | null = null;
    const finish = (keep: boolean) => {
      const r = res.current;
      if (!r?.stroke) return;
      const tiles = [...r.stroke.values()];
      r.stroke = null;
      r.cursor = null;
      last = null;
      if (keep && tiles.length) {
        r.undo.push(tiles);
        if (r.undo.length > 30) r.undo.shift();
        setUndoCount(r.undo.length);
        setTouched(true);
      } else if (!keep) {
        const p = ctx2d(r.preview);
        for (const t of tiles) p.putImageData(t.data, t.x, t.y);
        view.invalidate(r.preview, { refit: false });
      }
      host.render();
    };
    host.setInput({
      down: (p) => {
        const r = res.current;
        if (!r) return false;
        r.stroke = new Map();
        r.cursor = p;
        last = p;
        dab(p.x, p.y);
        return true;
      },
      move: (p) => {
        const r = res.current;
        if (!r || !last) return;
        const radius = (st.current.size / 2) * host.pxPerPt();
        const step = Math.max(1, radius * 0.3);
        const d = Math.hypot(p.x - last.x, p.y - last.y);
        const n = Math.floor(d / step);
        for (let i = 1; i <= n; i++) dab(last.x + ((p.x - last.x) * i * step) / d, last.y + ((p.y - last.y) * i * step) / d);
        if (n) last = { x: last.x + ((p.x - last.x) * n * step) / d, y: last.y + ((p.y - last.y) * n * step) / d };
        r.cursor = p;
      },
      up: () => finish(true),
      cancel: () => finish(false),
    });
    return () => host.setInput(null);
  }, []);

  const undoStroke = () => {
    const r = res.current;
    const tiles = r?.undo.pop();
    if (!r || !tiles) return;
    const p = ctx2d(r.preview);
    for (const t of tiles) p.putImageData(t.data, t.x, t.y);
    view.invalidate(r.preview, { refit: false });
    setUndoCount(r.undo.length);
  };

  const reset = () => {
    const r = res.current;
    if (!r) return;
    const p = ctx2d(r.preview);
    p.clearRect(0, 0, doc.width, doc.height);
    p.drawImage(doc.raster, 0, 0);
    r.undo = [];
    setUndoCount(0);
    setTouched(false);
    view.invalidate(r.preview, { refit: false });
  };

  useEffect(() => {
    host.setActions({
      applyDisabled: !touched,
      apply: () => {
        const r = res.current;
        if (!r || !touched) return;
        // The preview becomes the photo, as one undoable step.
        doc.replaceRaster('Remove Background', r.preview, doc.markup, true);
      },
    });
  }, [touched]);

  return (
    <div class="tool-body">
      <Segmented<Brush>
        label="Brush"
        value={mode}
        onChange={setMode}
        onGlass
        options={[
          { value: 'remove', label: 'Remove' },
          { value: 'keep', label: 'Keep' },
        ]}
      />
      <div class="tool-row compact">
        <span>Brush Size</span>
        <span class="t-num tool-value">{size} pt</span>
      </div>
      <Slider value={size} min={6} max={200} onChange={setSize} label="Brush size" valueText={(v) => `${v} points`} />
      <div class="tool-row compact">
        <span>Softness</span>
        <span class="t-num tool-value">{soft}%</span>
      </div>
      <Slider value={soft} min={0} max={100} onChange={setSoft} label="Softness" valueText={(v) => `${v} percent`} />
      <div class="button-row">
        <Button variant="gray" label="Undo Stroke" disabled={!undoCount} onClick={undoStroke} />
        <Button variant="gray" label="Start Over" disabled={!touched} onClick={reset} />
      </div>
      <p class="tool-note">
        Paint with Remove over what should go; Keep brings it back. Zoom in with two fingers for edges: the brush stays the same size on screen. Save as PNG or
        WebP to keep the transparency.
      </p>
    </div>
  );
}
