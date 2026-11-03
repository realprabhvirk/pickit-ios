import { useEffect, useState } from 'preact/hooks';
import type { ToolHost } from './host';
import {
  DEFAULT_DPI,
  formatPhysical,
  fromPixels,
  heightForWidth,
  isStretched,
  isValidDpi,
  parseNumber,
  toPixelsFrom,
  widthForHeight,
  type SizeUnit,
} from '../engine/geometry';
import { resizeCanvas } from '../engine/raster';
import { scale, transformAll } from '../engine/markup';
import { Segmented } from '../ui/Segmented';
import { Switch } from '../ui/Switch';

/** Resize in pixels, millimetres or centimetres (at a DPI), with the aspect ratio locked by default. */
export function ResizeTool({ host }: { host: ToolHost }) {
  const { doc } = host;
  const W = doc.width;
  const H = doc.height;
  const [unit, setUnit] = useState<SizeUnit>('px');
  const [dpi, setDpi] = useState(DEFAULT_DPI);
  const [dpiText, setDpiText] = useState(String(DEFAULT_DPI));
  const [w, setW] = useState(W);
  const [h, setH] = useState(H);
  const [lock, setLock] = useState(true);
  const [wText, setWText] = useState(String(W));
  const [hText, setHText] = useState(String(H));

  const show = (px: number) => formatPhysical(fromPixels(px, unit, dpi), unit);

  // Re-express the fields when the unit or DPI changes.
  useEffect(() => {
    setWText(show(w));
    setHText(show(h));
  }, [unit, dpi]);

  const setWidthFrom = (text: string) => {
    setWText(text);
    const v = parseNumber(text);
    if (v === null || v <= 0) return;
    const px = Math.max(1, toPixelsFrom(v, unit, dpi));
    setW(px);
    if (lock) {
      const nh = heightForWidth(W, H, px);
      setH(nh);
      setHText(show(nh));
    }
  };
  const setHeightFrom = (text: string) => {
    setHText(text);
    const v = parseNumber(text);
    if (v === null || v <= 0) return;
    const px = Math.max(1, toPixelsFrom(v, unit, dpi));
    setH(px);
    if (lock) {
      const nw = widthForHeight(W, H, px);
      setW(nw);
      setWText(show(nw));
    }
  };
  const percent = (p: number) => {
    const nw = Math.max(1, Math.round((W * p) / 100));
    const nh = Math.max(1, Math.round((H * p) / 100));
    setW(nw);
    setH(nh);
    setWText(show(nw));
    setHText(show(nh));
  };

  const valid = w >= 1 && h >= 1 && w <= 32_767 && h <= 32_767 && w * h <= 100_000_000;
  const enlarging = w > W || h > H;
  const stretched = !lock && isStretched(W, H, w, h);
  const unchanged = w === W && h === H;

  useEffect(() => {
    host.setActions({
      applyDisabled: unchanged || !valid,
      apply: () => {
        if (unchanged || !valid) return false;
        const next = resizeCanvas(doc.raster, w, h);
        doc.replaceRaster('Resize', next, transformAll(doc.markup, scale(w / W, h / H)));
      },
    });
  }, [w, h, valid]);

  const field = (label: string, value: string, onInput: (t: string) => void) => (
    <label class="tool-field">
      <span class="tool-field-label">
        {label} ({unit})
      </span>
      <input
        class="tool-input t-num"
        type="text"
        inputMode="decimal"
        enterKeyHint="done"
        autocomplete="off"
        value={value}
        onInput={(e) => onInput((e.currentTarget as HTMLInputElement).value)}
        onFocus={(e) => (e.currentTarget as HTMLInputElement).select()}
      />
    </label>
  );

  return (
    <div class="tool-body">
      <Segmented<SizeUnit>
        label="Units"
        value={unit}
        onChange={setUnit}
        onGlass
        options={[
          { value: 'px', label: 'Pixels' },
          { value: 'mm', label: 'mm' },
          { value: 'cm', label: 'cm' },
        ]}
      />
      <div class="tool-fields">
        {field('Width', wText, setWidthFrom)}
        {field('Height', hText, setHeightFrom)}
      </div>
      {unit !== 'px' && (
        <label class="tool-row">
          <span>Resolution (DPI)</span>
          <input
            class="tool-input small t-num"
            type="text"
            inputMode="numeric"
            value={dpiText}
            aria-label="Dots per inch"
            onInput={(e) => {
              const t = (e.currentTarget as HTMLInputElement).value;
              setDpiText(t);
              const v = Number(t);
              if (isValidDpi(v)) setDpi(v);
            }}
          />
        </label>
      )}
      <div class="tool-row">
        <span>Keep Proportions</span>
        <Switch
          checked={lock}
          onChange={(v) => {
            setLock(v);
            if (v) {
              const nh = heightForWidth(W, H, w);
              setH(nh);
              setHText(show(nh));
            }
          }}
          label="Keep proportions"
        />
      </div>
      <div class="chip-row">
        {[25, 50, 75, 100].map((p) => (
          <button type="button" class="chip" onClick={() => percent(p)}>
            {p}%
          </button>
        ))}
      </div>
      <p class="tool-note t-num">
        Now {W} × {H} px → {w} × {h} px
        {unit !== 'px' && ` · ${show(w)} × ${show(h)} ${unit} at ${dpi} DPI`}
      </p>
      {!valid && <p class="tool-warn">That size isn’t possible. Keep each side under 32,767 px and the total under 100 MP.</p>}
      {valid && enlarging && <p class="tool-warn">This is larger than the photo, so it will be enlarged and look softer.</p>}
      {valid && stretched && <p class="tool-warn">The proportions change, so the photo will look stretched.</p>}
    </div>
  );
}
