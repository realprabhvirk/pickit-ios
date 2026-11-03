import { useEffect, useMemo, useState } from 'preact/hooks';
import type { ToolHost } from './host';
import { loadPresets, type Preset } from '../engine/presets';
import { cropAmounts, initialCrop, planFit, toPixels, withAspect, type Rect } from '../engine/geometry';
import { cropCanvas, freeCanvas, resizeCanvas } from '../engine/raster';
import { scale, transformAll, translate } from '../engine/markup';
import { CropOverlay } from './CropOverlay';
import { Icon } from '../ui/Icon';

const pct = (f: number) => `${Math.round(f * 100)}%`;

/** Describe what a crop cuts, in plain words. */
function cutText(w: number, h: number, r: Rect): string {
  const a = cropAmounts(w, h, r);
  const sides: string[] = [];
  const lr = a.left + a.right;
  const tb = a.top + a.bottom;
  if (lr > 0.005) sides.push(Math.abs(a.left - a.right) < 0.01 ? `${pct(a.left)} from the left and right` : `${pct(lr)} from the sides`);
  if (tb > 0.005) sides.push(Math.abs(a.top - a.bottom) < 0.01 ? `${pct(a.top)} from the top and bottom` : `${pct(tb)} from the top and bottom`);
  return sides.length ? `Cuts ${sides.join(' and ')}.` : 'Nothing is cut.';
}

/**
 * Sizes for social posts, wallpapers and more, from the same list as PicKit for Windows.
 * Picking one shows the crop it needs over the photo (move it to choose what stays), the
 * preset's note, and what will be cut.
 */
export function ResizeForTool({ host }: { host: ToolHost }) {
  const { doc, view } = host;
  const W = doc.width;
  const H = doc.height;
  const catalog = useMemo(() => loadPresets(), []);
  const [preset, setPreset] = useState<Preset | null>(null);
  const [rect, setRect] = useState<Rect>(() => initialCrop(W, H));

  useEffect(() => {
    if (preset && !preset.fitOnly) setRect(withAspect({ x: 0, y: 0, w: W, h: H }, preset.width / preset.height, W, H));
  }, [preset]);

  const px = toPixels(rect, W, H);
  const fit = preset?.fitOnly ? planFit(W, H, preset.width, preset.height) : null;
  const enlarging = !!preset && !preset.fitOnly && (px.w < preset.width || px.h < preset.height);

  useEffect(() => {
    host.setActions({
      applyDisabled: !preset,
      apply: () => {
        if (!preset) return false;
        if (preset.fitOnly) {
          if (fit!.w === W && fit!.h === H) return;
          doc.replaceRaster(`Resize for ${preset.name}`, resizeCanvas(doc.raster, fit!.w, fit!.h), transformAll(doc.markup, scale(fit!.w / W, fit!.h / H)));
          return;
        }
        const cropped = cropCanvas(doc.raster, px);
        const next = resizeCanvas(cropped, preset.width, preset.height);
        freeCanvas(cropped);
        const m = transformAll(transformAll(doc.markup, translate(-px.x, -px.y)), scale(preset.width / px.w, preset.height / px.h));
        doc.replaceRaster(`Resize for ${preset.name}`, next, m);
      },
    });
  }, [preset, px.x, px.y, px.w, px.h]);

  if (preset) {
    return (
      <div class="tool-body">
        {!preset.fitOnly && <CropOverlay view={view} root={host.overlayEl} rect={rect} onChange={setRect} aspect={preset.width / preset.height} imageW={W} imageH={H} />}
        <button type="button" class="back-row" onClick={() => setPreset(null)}>
          <Icon name="chevron-left" />
          <span>All Sizes</span>
        </button>
        <div class="tool-row">
          <span class="t-emph">{preset.name}</span>
          <span class="t-num tool-value">
            {preset.width} × {preset.height}
          </span>
        </div>
        <p class="tool-note">{preset.note}</p>
        {preset.fitOnly ? (
          <p class="tool-note t-num">
            Scaled to {fit!.w} × {fit!.h}.{fit!.w === W && fit!.h === H ? ' Already fits, so nothing changes.' : ''}
          </p>
        ) : (
          <>
            <p class="tool-note">{cutText(W, H, px)} Drag the frame to choose what stays.</p>
            {enlarging && (
              <p class="tool-warn">
                The kept area is {px.w} × {px.h}, smaller than {preset.width} × {preset.height}, so it will be enlarged and look softer.
              </p>
            )}
          </>
        )}
        {preset.source && <p class="tool-note">Size from {new URL(preset.source).hostname.replace(/^www\./, '')}.</p>}
      </div>
    );
  }

  return (
    <div class="tool-body">
      {catalog.groups.map((g) => (
        <section>
          <h3 class="preset-group">{g.name}</h3>
          <div class="preset-rows">
            {g.presets.map((p) => (
              <button type="button" class="preset-row" onClick={() => setPreset(p)}>
                <span class="preset-main">
                  <span class="preset-name">{p.name}</span>
                  <span class="preset-note">{p.fitOnly ? 'Fits inside, no crop' : `${(p.width / p.height).toFixed(2).replace(/\.?0+$/, '')}:1`}</span>
                </span>
                <span class="preset-size t-num">
                  {p.width} × {p.height}
                </span>
                <Icon name="chevron-right" class="row-chevron" />
              </button>
            ))}
          </div>
        </section>
      ))}
      <p class="tool-note">Sizes checked {catalog.verified}.</p>
    </div>
  );
}
