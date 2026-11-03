import type { HTMLAttributes } from 'preact';

/**
 * Pointer-down feedback, the way iOS does it: highlight the instant a finger lands, follow it
 * while it stays on (with some slop), drop it when it leaves or lifts. Spread the returned
 * handlers onto any pressable element; it toggles a `pressed` class and, for glass, places the
 * highlight under the finger via --press-x/--press-y.
 */
export function pressHandlers(): Pick<
  HTMLAttributes<HTMLElement>,
  'onPointerDown' | 'onPointerUp' | 'onPointerCancel' | 'onPointerLeave' | 'onPointerMove'
> {
  return pressProps;
}

const SLOP = 24;
let origin: { x: number; y: number } | null = null;

function release(e: PointerEvent) {
  (e.currentTarget as HTMLElement).classList.remove('pressed');
  origin = null;
}

const pressProps = {
  onPointerDown(e: PointerEvent) {
    if (e.button > 0) return;
    const el = e.currentTarget as HTMLElement;
    if ((el as HTMLButtonElement).disabled) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--press-x', `${e.clientX - r.left}px`);
    el.style.setProperty('--press-y', `${e.clientY - r.top}px`);
    el.classList.add('pressed');
    origin = { x: e.clientX, y: e.clientY };
  },
  onPointerMove(e: PointerEvent) {
    if (!origin) return;
    const el = e.currentTarget as HTMLElement;
    const r = el.getBoundingClientRect();
    const inside =
      e.clientX > r.left - SLOP && e.clientX < r.right + SLOP && e.clientY > r.top - SLOP && e.clientY < r.bottom + SLOP;
    el.classList.toggle('pressed', inside);
    if (inside) {
      el.style.setProperty('--press-x', `${e.clientX - r.left}px`);
      el.style.setProperty('--press-y', `${e.clientY - r.top}px`);
    }
  },
  onPointerUp: release,
  onPointerCancel: release,
  onPointerLeave: release,
};
