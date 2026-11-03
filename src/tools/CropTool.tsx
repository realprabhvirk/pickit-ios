import { useEffect, useMemo, useState } from 'preact/hooks';
import type { ToolHost } from './host';
import { initialCrop, toPixels, withAspect, type Rect } from '../engine/geometry';
import { cropCanvas } from '../engine/raster';
import { transformAll, translate } from '../engine/markup';
import { Switch } from '../ui/Switch';
import { CropOverlay } from './CropOverlay';

type AspectId = 'free' | 'original' | '1:1' | '4:5' | '3:4' | '16:9' | '9:16';

export function CropTool({ host }: { host: ToolHost }) {
  const { doc, view } = host;
  const W = doc.width;
  const H = doc.height;
  const [aspectId, setAspectId] = useState<AspectId>('free');
  const [grid, setGrid] = useState(true);
  const [rect, setRect] = useState<Rect>(() => initialCrop(W, H));

  const aspect = useMemo(() => {
    switch (aspectId) {
      case 'original': return W / H;
      case '1:1': return 1;
      case '4:5': return 4 / 5;
      case '3:4': return 3 / 4;
      case '16:9': return 16 / 9;
      case '9:16': return 9 / 16;
      default: return undefined;
    }
  }, [aspectId, W, H]);

  useEffect(() => {
    if (aspect) setRect(withAspect({ x: 0, y: 0, w: W, h: H }, aspect, W, H));
  }, [aspect]);

  const px = toPixels(rect, W, H);
  const unchanged = px.x === 0 && px.y === 0 && px.w === W && px.h === H;

  useEffect(() => {
    host.setActions({
      applyDisabled: unchanged,
      apply: () => {
        if (unchanged) return;
        const next = cropCanvas(doc.raster, px);
        doc.replaceRaster('Crop', next, transformAll(doc.markup, translate(-px.x, -px.y)));
      },
    });
  }, [px.x, px.y, px.w, px.h]);

  return (
    <div class="tool-body">
      <CropOverlay view={view} root={host.overlayEl} rect={rect} onChange={setRect} aspect={aspect} imageW={W} imageH={H} grid={grid} />
      <div class="chip-row" role="radiogroup" aria-label="Aspect ratio">
        {(
          [
            ['free', 'Freeform'],
            ['original', 'Original'],
            ['1:1', 'Square'],
            ['4:5', '4:5'],
            ['3:4', '3:4'],
            ['16:9', '16:9'],
            ['9:16', '9:16'],
          ] as [AspectId, string][]
        ).map(([id, label]) => (
          <button type="button" role="radio" aria-checked={aspectId === id} class="chip" onClick={() => setAspectId(id)}>
            {label}
          </button>
        ))}
      </div>
      <div class="tool-row">
        <span class="t-num">
          {px.w} × {px.h}
        </span>
        <button type="button" class="link-btn" onClick={() => setRect(aspect ? withAspect({ x: 0, y: 0, w: W, h: H }, aspect, W, H) : initialCrop(W, H))}>
          Reset
        </button>
      </div>
      <div class="tool-row">
        <span>Grid</span>
        <Switch checked={grid} onChange={setGrid} label="Show grid" />
      </div>
      <p class="tool-note">Drag the corners or edges, or drag inside to move the frame. Pinch with two fingers to zoom.</p>
    </div>
  );
}
