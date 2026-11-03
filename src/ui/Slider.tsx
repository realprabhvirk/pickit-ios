import { useRef, useState } from 'preact/hooks';
import { Icon, type IconName } from './Icon';

interface SliderProps {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
  onCommit?: (value: number) => void;
  label: string;
  /** Spoken value, e.g. "80 percent". */
  valueText?: (value: number) => string;
  minIcon?: IconName;
  maxIcon?: IconName;
}

/**
 * Slider with a capsule thumb that turns into a glassy lens while dragged. Grab the thumb to
 * move it relative to where you grabbed; press the track to jump there and keep dragging.
 * Vertical swipes still scroll the sheet (touch-action: pan-y).
 */
export function Slider({ value, min = 0, max = 100, step = 1, onChange, onCommit, label, valueText, minIcon, maxIcon }: SliderProps) {
  const track = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const grab = useRef({ offset: 0, active: false, last: value });
  const p = (value - min) / (max - min || 1);

  const fromClientX = (x: number) => {
    const el = track.current!;
    const r = el.getBoundingClientRect();
    const thumbW = 38;
    const usable = Math.max(1, r.width - thumbW);
    const t = Math.min(1, Math.max(0, (x - r.left - thumbW / 2 - grab.current.offset) / usable));
    const raw = min + t * (max - min);
    const snapped = Math.round(raw / step) * step;
    return Math.min(max, Math.max(min, Number(snapped.toFixed(6))));
  };

  const down = (e: PointerEvent) => {
    if (e.button > 0) return;
    const el = track.current!;
    const r = el.getBoundingClientRect();
    const thumbW = 38;
    const thumbLeft = r.left + (r.width - thumbW) * p;
    const onThumb = e.clientX >= thumbLeft - 8 && e.clientX <= thumbLeft + thumbW + 8;
    grab.current.offset = onThumb ? e.clientX - (thumbLeft + thumbW / 2) : 0;
    grab.current.active = true;
    el.setPointerCapture(e.pointerId);
    setDragging(true);
    const v = fromClientX(e.clientX);
    grab.current.last = v;
    if (v !== value) onChange(v);
  };
  const move = (e: PointerEvent) => {
    if (!grab.current.active) return;
    const v = fromClientX(e.clientX);
    if (v !== grab.current.last) {
      grab.current.last = v;
      onChange(v);
    }
  };
  const up = () => {
    if (!grab.current.active) return;
    grab.current.active = false;
    setDragging(false);
    onCommit?.(grab.current.last);
  };

  const onKey = (e: KeyboardEvent) => {
    let v = value;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') v = Math.min(max, value + step);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') v = Math.max(min, value - step);
    else if (e.key === 'Home') v = min;
    else if (e.key === 'End') v = max;
    else return;
    e.preventDefault();
    onChange(v);
    onCommit?.(v);
  };

  return (
    <div class={`slider${dragging ? ' dragging' : ''}`} style={{ '--p': String(p) }}>
      {minIcon && (
        <span class="slider-end">
          <Icon name={minIcon} />
        </span>
      )}
      <div
        ref={track}
        class="slider-track"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={valueText?.(value)}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onKeyDown={onKey}
      >
        <span class="slider-rail" />
        <span class="slider-fill" />
        <span class="slider-thumb" />
      </div>
      {maxIcon && (
        <span class="slider-end">
          <Icon name={maxIcon} />
        </span>
      )}
    </div>
  );
}
