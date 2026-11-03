import { useEffect, useRef, useState } from 'preact/hooks';
import type { ToolHost } from './host';
import { createCanvas, ctx2d, freeCanvas, readPixels, writePixels } from '../engine/raster';
import { blurPixels, pixelatePixels } from '../engine/worker';
import type { Rect } from '../engine/geometry';
import { Segmented } from '../ui/Segmented';
import { Slider } from '../ui/Slider';
import { Icon, type IconName } from '../ui/Icon';
import { showToast } from '../app/overlays';
import { haptic } from '../ui/haptics';

type Effect = 'blur' | 'pixelate' | 'redact';
type Shape = 'box' | 'rounded' | 'ellipse' | 'brush';

const SHAPES: { id: Shape; icon: IconName; label: string }[] = [
  { id: 'box', icon: 'square', label: 'Box' },
  { id: 'rounded', icon: 'rounded', label: 'Rounded' },
  { id: 'ellipse', icon: 'circle', label: 'Ellipse' },
  { id: 'brush', icon: 'brush', label: 'Brush' },
];

interface Gesture {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  points: number[];
}

function shapePath(ctx: CanvasRenderingContext2D, shape: Shape, r: Rect, points: number[], brush: number, ox = 0, oy = 0) {
  ctx.beginPath();
  if (shape === 'brush') {
    ctx.lineWidth = brush;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.moveTo(points[0] - ox, points[1] - oy);
    for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i] - ox, points[i + 1] - oy);
    if (points.length === 2) ctx.lineTo(points[0] - ox + 0.01, points[1] - oy);
    return;
  }
  const x = r.x - ox;
  const y = r.y - oy;
  if (shape === 'ellipse') ctx.ellipse(x + r.w / 2, y + r.h / 2, Math.max(0.5, r.w / 2), Math.max(0.5, r.h / 2), 0, 0, Math.PI * 2);
  else if (shape === 'rounded' && typeof ctx.roundRect === 'function') ctx.roundRect(x, y, r.w, r.h, Math.min(r.w, r.h) * 0.22);
  else ctx.rect(x, y, r.w, r.h);
}

/**
 * Blur, pixelate or redact part of the photo. This changes the pixels themselves (it isn't an
 * overlay), so exports can't be un-blurred. Redaction writes solid colour into the image data.
 */
export function PrivacyTool({ host }: { host: ToolHost }) {
  const { doc, view } = host;
  const [effect, setEffect] = useState<Effect>('blur');
  const [shape, setShape] = useState<Shape>('box');
  const [strength, setStrength] = useState(50);
  const [brush, setBrush] = useState(36);
  const [redactColor, setRedactColor] = useState('#000000');
  const [busy, setBusy] = useState(false);
  const start = useRef(doc.history.length);
  const g = useRef<Gesture | null>(null);
  const st = useRef({ effect, shape, strength, brush, redactColor, busy });
  st.current = { effect, shape, strength, brush, redactColor, busy };

  const brushPx = () => st.current.brush * host.pxPerPt();
  const shapeRect = (ge: Gesture): Rect => {
    if (st.current.shape === 'brush') {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < ge.points.length; i += 2) {
        x0 = Math.min(x0, ge.points[i]);
        y0 = Math.min(y0, ge.points[i + 1]);
        x1 = Math.max(x1, ge.points[i]);
        y1 = Math.max(y1, ge.points[i + 1]);
      }
      const r = brushPx() / 2;
      return { x: x0 - r, y: y0 - r, w: x1 - x0 + r * 2, h: y1 - y0 + r * 2 };
    }
    return { x: Math.min(ge.x0, ge.x1), y: Math.min(ge.y0, ge.y1), w: Math.abs(ge.x1 - ge.x0), h: Math.abs(ge.y1 - ge.y0) };
  };

  // Outline of the shape being drawn.
  useEffect(
    () =>
      host.addOverlay((ctx) => {
        const ge = g.current;
        if (!ge) return;
        const r = shapeRect(ge);
        const s = 1 / view.vt.zoom;
        ctx.save();
        shapePath(ctx, st.current.shape, r, ge.points, brushPx());
        if (st.current.shape === 'brush') {
          ctx.strokeStyle = 'rgba(10,132,255,0.45)';
          ctx.stroke();
        } else {
          ctx.fillStyle = 'rgba(10,132,255,0.18)';
          ctx.fill();
          ctx.lineWidth = 2 * s;
          ctx.setLineDash([6 * s, 5 * s]);
          ctx.strokeStyle = '#ffffff';
          ctx.stroke();
          ctx.lineDashOffset = 6 * s;
          ctx.strokeStyle = '#0A84FF';
          ctx.stroke();
        }
        ctx.restore();
      }),
    [],
  );

  const applyTo = async (ge: Gesture) => {
    const { effect: fx, shape: sh, strength: k, redactColor: rc } = st.current;
    const r = shapeRect(ge);
    const x0 = Math.max(0, Math.floor(r.x));
    const y0 = Math.max(0, Math.floor(r.y));
    const x1 = Math.min(doc.width, Math.ceil(r.x + r.w));
    const y1 = Math.min(doc.height, Math.ceil(r.y + r.h));
    if (x1 - x0 < 2 || y1 - y0 < 2) return;
    const bounds = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    const before = readPixels(doc.raster, bounds);
    const minSide = Math.min(doc.width, doc.height);

    // Build the effect for the area (with margin so blur reaches past the edges).
    let effectCanvas: HTMLCanvasElement | null = null;
    let ex = x0;
    let ey = y0;
    if (fx !== 'redact') {
      const radius = Math.max(2, Math.round(minSide * 0.0005 * k));
      const pad = fx === 'blur' ? radius * 2 : 0;
      ex = Math.max(0, x0 - pad);
      ey = Math.max(0, y0 - pad);
      const ew = Math.min(doc.width, x1 + pad) - ex;
      const eh = Math.min(doc.height, y1 + pad) - ey;
      const px = readPixels(doc.raster, { x: ex, y: ey, w: ew, h: eh });
      const out = fx === 'blur' ? await blurPixels(px, radius) : await pixelatePixels(px, Math.max(4, Math.round(minSide * 0.0007 * k)), ex, ey);
      effectCanvas = createCanvas(out.width, out.height);
      writePixels(effectCanvas, out);
    }

    // Mask in the shape, then paint it into the photo.
    const mask = createCanvas(bounds.w, bounds.h);
    const m = ctx2d(mask);
    m.fillStyle = m.strokeStyle = fx === 'redact' ? rc : '#000';
    shapePath(m, sh, r, ge.points, brushPx(), x0, y0);
    if (sh === 'brush') m.stroke();
    else m.fill();
    if (effectCanvas) {
      m.globalCompositeOperation = 'source-in';
      m.drawImage(effectCanvas, ex - x0, ey - y0);
    }
    const ctx = ctx2d(doc.raster);
    ctx.drawImage(mask, x0, y0);
    if (fx === 'redact') {
      // Belt and braces: solid colour, fully opaque, written straight into the pixel data for the shape's core.
      const solid = readPixels(doc.raster, bounds);
      const mk = readPixels(mask);
      const [rr, gg, bb] = [1, 3, 5].map((i) => parseInt(rc.slice(i, i + 2), 16));
      for (let i = 0; i < mk.data.length; i += 4) {
        if (mk.data[i + 3] >= 128) {
          solid.data[i] = rr;
          solid.data[i + 1] = gg;
          solid.data[i + 2] = bb;
          solid.data[i + 3] = 255;
        }
      }
      writePixels(doc.raster, solid, x0, y0);
    }
    freeCanvas(mask);
    freeCanvas(effectCanvas);
    doc.commit(doc.history.regionStep(fx === 'redact' ? 'Redact' : fx === 'blur' ? 'Blur' : 'Pixelate', bounds, before));
    haptic();
  };

  useEffect(() => {
    host.setInput({
      down: (p) => {
        if (st.current.busy) return true;
        g.current = { x0: p.x, y0: p.y, x1: p.x, y1: p.y, points: [p.x, p.y] };
        host.render();
        return true;
      },
      move: (p) => {
        const ge = g.current;
        if (!ge) return;
        ge.x1 = p.x;
        ge.y1 = p.y;
        if (st.current.shape === 'brush') ge.points.push(p.x, p.y);
        host.render();
      },
      up: () => {
        const ge = g.current;
        if (!ge) return;
        setBusy(true);
        applyTo(ge)
          .catch(() => showToast({ icon: 'privacy', title: 'That didn’t work', subtitle: 'Try a smaller area.', duration: 2600 }))
          .finally(() => {
            g.current = null;
            setBusy(false);
            host.render();
          });
      },
      cancel: () => {
        g.current = null;
        host.render();
      },
    });
    return () => host.setInput(null);
  }, []);

  useEffect(() => {
    host.setActions({
      cancel: async () => {
        await doc.history.rollback(doc, start.current);
        doc.touch(true);
      },
    });
  }, []);

  const meta = doc.meta;
  return (
    <div class="tool-body">
      <Segmented<Effect>
        label="Effect"
        value={effect}
        onChange={setEffect}
        onGlass
        options={[
          { value: 'blur', label: 'Blur' },
          { value: 'pixelate', label: 'Pixelate' },
          { value: 'redact', label: 'Redact' },
        ]}
      />
      <div class="tile-row" role="radiogroup" aria-label="Shape">
        {SHAPES.map((s) => (
          <button type="button" role="radio" aria-checked={shape === s.id} class="tool-tile" onClick={() => setShape(s.id)}>
            <Icon name={s.icon} />
            <span>{s.label}</span>
          </button>
        ))}
      </div>
      {effect === 'redact' ? (
        <div class="tool-row">
          <span>Colour</span>
          <span class="row-actions">
            {['#000000', '#FFFFFF'].map((c) => (
              <button
                type="button"
                class="swatch small"
                role="radio"
                aria-checked={redactColor === c}
                aria-label={c === '#000000' ? 'Black' : 'White'}
                style={{ '--sw': c }}
                onClick={() => setRedactColor(c)}
              />
            ))}
          </span>
        </div>
      ) : (
        <>
          <div class="tool-row compact">
            <span>Strength</span>
            <span class="t-num tool-value">{strength}</span>
          </div>
          <Slider value={strength} min={5} max={100} onChange={setStrength} label="Strength" />
        </>
      )}
      {shape === 'brush' && (
        <>
          <div class="tool-row compact">
            <span>Brush Size</span>
            <span class="t-num tool-value">{brush} pt</span>
          </div>
          <Slider value={brush} min={8} max={120} onChange={setBrush} label="Brush size" valueText={(v) => `${v} points`} />
        </>
      )}
      <p class="tool-note">
        {busy ? 'Working…' : shape === 'brush' ? 'Paint over what to hide.' : 'Drag over what to hide.'} This changes the pixels themselves, so it can’t be undone
        by anyone you send the photo to.
      </p>
      {meta?.hasPrivateInfo && (
        <p class="tool-note">
          This photo also carries {[meta.location && 'its location', meta.camera && 'camera details', meta.author && 'an author name'].filter(Boolean).join(', ') || 'hidden details'}. See Details to remove them.
        </p>
      )}
    </div>
  );
}
