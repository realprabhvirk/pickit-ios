import { useMemo } from 'preact/hooks';
import { springEasing, springs } from '../design/motion';
import { pressHandlers } from './press';
import { haptic } from './haptics';

interface SegmentedProps<T extends string> {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  /** Set when the control floats directly over content rather than inside a sheet. */
  onGlass?: boolean;
}

/** Capsule segmented control with a sliding selection. Inside glass it uses a flat track. */
export function Segmented<T extends string>({ options, value, onChange, label, onGlass }: SegmentedProps<T>) {
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const motion = useMemo(() => springEasing(springs.snappy), []);
  const n = options.length;

  const onKey = (e: KeyboardEvent) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = options[(index + step + n) % n];
    onChange(next.value);
  };

  return (
    <div class={`segmented${onGlass ? ' on-glass' : ''}`} role="radiogroup" aria-label={label} onKeyDown={onKey}>
      <span
        class="seg-thumb"
        aria-hidden="true"
        style={{
          width: `calc((100% - var(--seg-pad) * 2) / ${n})`,
          transform: `translateX(${index * 100}%)`,
          transition: `transform ${Math.round(motion.duration * 1000)}ms ${motion.easing}`,
        }}
      />
      {options.map((o, i) => (
        <button
          type="button"
          role="radio"
          class="seg-item"
          aria-checked={i === index}
          tabIndex={i === index ? 0 : -1}
          onClick={() => {
            if (o.value !== value) {
              haptic();
              onChange(o.value);
            }
          }}
          {...pressHandlers()}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
