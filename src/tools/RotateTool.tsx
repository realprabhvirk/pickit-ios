import { useEffect, useRef, useState } from 'preact/hooks';
import type { ToolHost } from './host';
import { flipCanvas, rotateCanvas90, straightenCanvas, cropCanvas, ctx2d, freeCanvas } from '../engine/raster';
import { drawAll, flipH, flipV, rotateCCW, rotateCW, transformAll } from '../engine/markup';
import { straightenScale } from '../engine/geometry';
import { Slider } from '../ui/Slider';
import { Icon } from '../ui/Icon';
import { pressHandlers } from '../ui/press';

/** Quarter turns and flips apply at once (each undoable). Straightening previews live and applies with ✓. */
export function RotateTool({ host }: { host: ToolHost }) {
  const { doc, view } = host;
  const [angle, setAngle] = useState(0);
  const start = useRef(doc.history.length);

  const quarter = (cw: boolean) => {
    const W = doc.width;
    const H = doc.height;
    doc.replaceRaster(cw ? 'Rotate Right' : 'Rotate Left', rotateCanvas90(doc.raster, cw), transformAll(doc.markup, cw ? rotateCW(H) : rotateCCW(W)));
  };
  const flip = (horizontal: boolean) => {
    doc.replaceRaster(
      horizontal ? 'Flip Horizontal' : 'Flip Vertical',
      flipCanvas(doc.raster, horizontal),
      transformAll(doc.markup, horizontal ? flipH(doc.width) : flipV(doc.height)),
    );
  };

  // Live straighten preview, plus a level grid while it's off zero.
  useEffect(() => {
    const rad = (angle * Math.PI) / 180;
    view.previewRotation = rad;
    view.previewScale = straightenScale(doc.width, doc.height, rad);
    view.requestRender();
  }, [angle]);
  useEffect(() => {
    const remove = host.addOverlay((ctx) => {
      if (!view.previewRotation) return;
      // Drawn in rotated space; undo the rotation so the grid stays level.
      const w = doc.width;
      const h = doc.height;
      ctx.translate(w / 2, h / 2);
      ctx.scale(view.previewScale, view.previewScale);
      ctx.rotate(-view.previewRotation);
      ctx.translate(-w / 2, -h / 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 1 / view.vt.zoom / view.vt.dpr;
      ctx.beginPath();
      for (let i = 1; i < 6; i++) {
        ctx.moveTo((w * i) / 6, 0);
        ctx.lineTo((w * i) / 6, h);
        ctx.moveTo(0, (h * i) / 6);
        ctx.lineTo(w, (h * i) / 6);
      }
      ctx.stroke();
    });
    return () => {
      remove();
      view.previewRotation = 0;
      view.previewScale = 1;
      view.requestRender();
    };
  }, []);

  useEffect(() => {
    host.setActions({
      apply: () => {
        if (!angle) return;
        const rad = (angle * Math.PI) / 180;
        const k = straightenScale(doc.width, doc.height, rad);
        // Markup can't be rotated as vectors and stay a rectangle, so it's drawn into the photo here.
        let src = doc.raster;
        let temp: HTMLCanvasElement | null = null;
        if (doc.markup.length) {
          temp = cropCanvas(doc.raster, { x: 0, y: 0, w: doc.width, h: doc.height });
          drawAll(ctx2d(temp), doc.markup);
          src = temp;
        }
        const next = straightenCanvas(src, rad, k);
        freeCanvas(temp);
        view.previewRotation = 0;
        view.previewScale = 1;
        doc.replaceRaster('Straighten', next, []);
      },
      cancel: async () => {
        view.previewRotation = 0;
        view.previewScale = 1;
        await doc.history.rollback(doc, start.current);
        doc.touch(true);
      },
    });
  }, [angle]);

  const btn = (icon: Parameters<typeof Icon>[0]['name'], label: string, onClick: () => void) => (
    <button type="button" class="tool-tile" onClick={onClick} {...pressHandlers()}>
      <Icon name={icon} />
      <span>{label}</span>
    </button>
  );

  return (
    <div class="tool-body">
      <div class="tile-row">
        {btn('rotate-left', 'Left', () => quarter(false))}
        {btn('rotate', 'Right', () => quarter(true))}
        {btn('flip-h', 'Flip ↔', () => flip(true))}
        {btn('flip-v', 'Flip ↕', () => flip(false))}
      </div>
      <div class="tool-row">
        <span>Straighten</span>
        <span class="t-num tool-value">{angle > 0 ? '+' : ''}{angle.toFixed(1)}°</span>
      </div>
      <Slider
        value={angle}
        min={-45}
        max={45}
        step={0.5}
        onChange={setAngle}
        label="Straighten"
        valueText={(v) => `${v.toFixed(1)} degrees`}
      />
      <div class="chip-row">
        <button type="button" class="chip" onClick={() => setAngle(0)}>
          Reset
        </button>
      </div>
      <p class="tool-note">Straightening trims the corners so nothing is empty{doc.markup.length ? ', and draws your markup into the photo' : ''}.</p>
    </div>
  );
}
