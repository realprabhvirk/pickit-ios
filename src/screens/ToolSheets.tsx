import { useState } from 'preact/hooks';
import { Segmented } from '../ui/Segmented';
import { Slider } from '../ui/Slider';
import { Switch } from '../ui/Switch';
import { loadPresets } from '../engine/presets';

export type ToolId = 'crop' | 'resize' | 'rotate' | 'markup' | 'privacy' | 'background' | 'compress' | 'resizeFor' | 'details';

const TITLES: Record<ToolId, string> = {
  crop: 'Crop',
  resize: 'Resize',
  rotate: 'Rotate',
  markup: 'Markup',
  privacy: 'Privacy',
  background: 'Remove Background',
  compress: 'Compress',
  resizeFor: 'Resize For',
  details: 'Details',
};

const PHASE: Record<ToolId, number> = {
  crop: 2,
  resize: 2,
  rotate: 2,
  markup: 2,
  privacy: 3,
  background: 3,
  compress: 2,
  resizeFor: 2,
  details: 1,
};

export const toolTitle = (t: ToolId) => TITLES[t];

const SWATCHES = ['#000000', 'var(--red)', 'var(--orange)', 'var(--yellow)', 'var(--green)', 'var(--blue)', 'var(--purple)', '#ffffff'];

/**
 * Phase 0 shows each tool's real controls so glass, sheets and gestures can be judged on the
 * phone. They don't edit yet, and the sheet says so.
 */
export function ToolPreview({ tool }: { tool: ToolId }) {
  const [seg, setSeg] = useState('a');
  const [val, setVal] = useState(60);
  const [on, setOn] = useState(true);
  const [swatch, setSwatch] = useState(1);

  const segmented = (opts: [string, string][], label: string) => (
    <Segmented options={opts.map(([value, l]) => ({ value, label: l }))} value={seg} onChange={setSeg} label={label} onGlass />
  );

  const body = () => {
    switch (tool) {
      case 'crop':
        return (
          <>
            {segmented([['a', 'Free'], ['b', 'Original'], ['c', '1:1'], ['d', '4:5'], ['e', '16:9']], 'Aspect ratio')}
            <div class="tool-row">
              <span>Show grid</span>
              <Switch checked={on} onChange={setOn} label="Show grid" />
            </div>
          </>
        );
      case 'resize':
        return (
          <>
            {segmented([['a', 'Pixels'], ['b', 'mm'], ['c', 'cm']], 'Units')}
            <div class="tool-fields t-num">
              <div class="tool-field"><span class="tool-field-label">Width</span><span>4032</span></div>
              <div class="tool-field"><span class="tool-field-label">Height</span><span>3024</span></div>
            </div>
            <div class="tool-row">
              <span>Keep aspect ratio</span>
              <Switch checked={on} onChange={setOn} label="Keep aspect ratio" />
            </div>
          </>
        );
      case 'rotate':
        return (
          <>
            <div class="tool-caption t-num">Straighten {Math.round((val - 50) * 0.9)}°</div>
            <Slider value={val} onChange={setVal} label="Straighten" valueText={(v) => `${Math.round((v - 50) * 0.9)} degrees`} />
          </>
        );
      case 'markup':
        return (
          <>
            {segmented([['a', 'Pen'], ['b', 'Arrow'], ['c', 'Shape'], ['d', 'Text'], ['e', 'Erase']], 'Markup tool')}
            <div class="swatches" role="radiogroup" aria-label="Colour">
              {SWATCHES.map((c, i) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={swatch === i}
                  aria-label={['Black', 'Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Purple', 'White'][i]}
                  class="swatch"
                  style={{ '--sw': c }}
                  onClick={() => setSwatch(i)}
                />
              ))}
            </div>
            <Slider value={val} onChange={setVal} label="Line width" />
          </>
        );
      case 'privacy':
        return (
          <>
            {segmented([['a', 'Blur'], ['b', 'Pixelate'], ['c', 'Redact']], 'Effect')}
            <div class="tool-caption">Strength</div>
            <Slider value={val} onChange={setVal} label="Strength" />
          </>
        );
      case 'background':
        return (
          <>
            {segmented([['a', 'Keep'], ['b', 'Remove']], 'Brush')}
            <div class="tool-caption">Brush size</div>
            <Slider value={val} onChange={setVal} label="Brush size" />
          </>
        );
      case 'compress':
        return (
          <>
            {segmented([['a', 'JPEG'], ['b', 'PNG'], ['c', 'WebP']], 'Format')}
            <div class="tool-caption t-num">Quality {val}%</div>
            <Slider value={val} onChange={setVal} label="Quality" valueText={(v) => `${v} percent`} />
          </>
        );
      case 'resizeFor':
        return <PresetList />;
      default:
        return null;
    }
  };

  return (
    <div class="tool-body">
      {body()}
      <p class="tool-note">These are the {TITLES[tool]} controls as they'll look. They don't change the photo yet: this tool is built in Phase {PHASE[tool]}.</p>
    </div>
  );
}

function PresetList() {
  const cat = loadPresets();
  return (
    <div class="preset-list">
      {cat.groups.map((g) => (
        <section>
          <h3 class="preset-group">{g.name}</h3>
          <div class="preset-rows">
            {g.presets.map((p) => (
              <div class="preset-row">
                <div class="preset-main">
                  <span class="preset-name">{p.name}</span>
                  <span class="preset-note">{p.note}</span>
                </div>
                <span class="preset-size t-num">
                  {p.width} × {p.height}
                </span>
              </div>
            ))}
          </div>
        </section>
      ))}
      <p class="tool-note">Sizes checked {cat.verified}.</p>
    </div>
  );
}
