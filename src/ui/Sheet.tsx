import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { SpringValue, VelocityTracker, prefersReducedMotion, project, rubberband, springs } from '../design/motion';
import { pushBack } from '../app/back';

export type Detent = 'medium' | 'large';

export interface SheetProps {
  open: boolean;
  /** The user dismissed it (dragged down, went back, tapped outside). Set `open` false in response. */
  onDismiss: () => void;
  /** Runs after the exit animation, once the sheet is gone. */
  onClosed?: () => void;
  title?: string;
  leading?: ComponentChildren;
  trailing?: ComponentChildren;
  detents?: Detent[];
  initial?: Detent;
  dismissible?: boolean;
  /** Dims and blocks what's behind. Off for tool sheets, so the photo stays usable. */
  modal?: boolean;
  /** Distance from the top of the phone where the sheet should emerge, e.g. the toolbar's top edge. */
  originY?: number;
  /** Visible height from the bottom of the phone, every frame. Use it imperatively, not as state. */
  onVisibleHeight?: (h: number) => void;
  children?: ComponentChildren;
  id?: string;
}

const MEDIUM_INSET = 8;
const HIDDEN = -40;

/**
 * Floating sheet with medium and large detents, in the iOS 26 style: inset from the screen with
 * concentric corners at medium, edge to edge at large. Drag the header anywhere, or the content
 * when it's scrolled to the top. Release velocity is projected forward to pick the detent and
 * handed to the spring, so a flick carries through. It can be grabbed mid-animation.
 */
export function Sheet(props: SheetProps) {
  const { open } = props;
  const [mounted, setMounted] = useState(open);
  const layer = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const dim = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLDivElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  const st = useRef({
    H: 0,
    medium: 0,
    large: 0,
    heights: [] as number[],
    startP: HIDDEN,
    unregister: null as null | (() => void),
    closedByBack: false,
    closing: false,
    pos: null as SpringValue | null,
    tracker: new VelocityTracker(),
    drag: null as null | { y0: number; p0: number; mode: 'sheet' | 'scroll' | 'undecided'; x0: number },
  });

  const measure = () => {
    const s = st.current;
    const p = propsRef.current;
    const H = layer.current!.clientHeight;
    const safeTop = probe.current!.offsetHeight;
    s.H = H;
    s.medium = Math.round(H * 0.5);
    s.large = Math.round(H - safeTop - 10);
    const detents = p.detents ?? ['medium', 'large'];
    s.heights = detents.map((d) => (d === 'medium' ? s.medium : s.large)).sort((a, b) => a - b);
    s.startP = p.originY !== undefined ? Math.max(40, H - MEDIUM_INSET - p.originY) : HIDDEN;
  };

  const apply = (p: number) => {
    const s = st.current;
    const el = sheet.current;
    if (!el) return;
    const minH = s.heights[0];
    const maxH = s.heights[s.heights.length - 1];
    let height: number;
    let ty: number;
    if (p >= minH) {
      height = p <= maxH ? p : maxH + rubberband(p - maxH, s.H * 0.5);
      ty = 0;
    } else {
      height = minH;
      const below = minH - p;
      ty = propsRef.current.dismissible === false && !s.closing ? rubberband(below, s.H * 0.5) : below;
    }
    const span = s.large - s.medium;
    const prog = span > 0 ? Math.min(1, Math.max(0, (height - s.medium) / span)) : 1;
    const inset = MEDIUM_INSET * (1 - prog);
    el.style.setProperty('--sheet-inset', `${inset.toFixed(2)}px`);
    el.style.height = `${height.toFixed(2)}px`;
    el.style.transform = `translate3d(0, ${ty.toFixed(2)}px, 0)`;
    if (dim.current) {
      const shown = Math.min(1, Math.max(0, p / minH));
      dim.current.style.opacity = String(propsRef.current.modal ? 0.3 * shown : 0.14 * prog);
    }
    propsRef.current.onVisibleHeight?.(Math.max(0, height - ty + inset));
  };

  const settleTo = (target: number, velocity = 0) => {
    const s = st.current;
    s.pos!.animateTo(target, { velocity, params: springs.sheet });
  };

  const release = (v: number) => {
    const s = st.current;
    const p = s.pos!.value;
    const projected = p + project(v, 0.99);
    const candidates = [...s.heights];
    const canDismiss = propsRef.current.dismissible !== false;
    if (canDismiss) candidates.push(HIDDEN);
    let target = candidates[0];
    for (const c of candidates) if (Math.abs(c - projected) < Math.abs(target - projected)) target = c;
    if (target === HIDDEN) {
      s.pos!.velocity = v;
      propsRef.current.onDismiss();
      return;
    }
    settleTo(target, v);
  };

  // Open / close lifecycle
  useEffect(() => {
    if (open) {
      const s = st.current;
      const reopening = s.closing && s.pos;
      s.closing = false;
      setMounted(true);
      if (reopening) {
        // Grabbed back while closing: turn around from wherever it is now.
        body.current?.getAnimations().forEach((a) => a.cancel());
        sheet.current?.getAnimations().forEach((a) => a.cancel());
        settleTo(s.heights[0]);
        s.closedByBack = false;
        s.unregister = pushBack(() => {
          s.closedByBack = true;
          propsRef.current.onDismiss();
        });
      }
    } else if (mounted) {
      const s = st.current;
      s.closing = true;
      if (s.unregister && !s.closedByBack) s.unregister();
      s.unregister = null;
      const target = propsRef.current.originY !== undefined ? s.startP : HIDDEN;
      const fade = () => {
        const el = sheet.current;
        if (!el || prefersReducedMotion()) return Promise.resolve();
        return el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, easing: 'ease-out', fill: 'forwards' }).finished.catch(() => {});
      };
      if (body.current) body.current.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, fill: 'forwards' });
      s.pos!.animateTo(target, { params: { response: 0.3, damping: 1 } }).then(() => {
        if (!st.current.closing) return;
        return fade().then(() => {
          if (!st.current.closing) return;
          setMounted(false);
          propsRef.current.onClosed?.();
        });
      });
    }
  }, [open]);

  // First frame after mounting: measure and spring up from the origin.
  useLayoutEffect(() => {
    if (!mounted || !open) return;
    const s = st.current;
    measure();
    s.closedByBack = false;
    s.pos = new SpringValue(s.startP, apply, springs.sheet, 1);
    apply(s.startP);
    const initial = propsRef.current.initial === 'large' ? s.large : s.heights[0];
    const target = s.heights.includes(initial) ? initial : s.heights[0];
    requestAnimationFrame(() => s.pos!.animateTo(target, { params: springs.default }));
    if (body.current && propsRef.current.originY !== undefined && !prefersReducedMotion()) {
      body.current.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, delay: 60, easing: 'ease-out', fill: 'backwards' });
    }
    s.unregister = pushBack(() => {
      s.closedByBack = true;
      propsRef.current.onDismiss();
    });
    sheet.current?.focus({ preventScroll: true });

    const onResize = () => {
      const before = s.pos!.target;
      const wasLarge = before >= s.large - 1;
      measure();
      s.pos!.set(wasLarge ? s.large : s.heights[0]);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      s.pos?.stop();
    };
  }, [mounted]);

  // Content drag: when scrolled to the top, pulling down moves the sheet; pulling up expands it first.
  useEffect(() => {
    const el = body.current;
    if (!mounted || !el) return;
    const s = st.current;
    const start = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const target = e.target as Element;
      if (target.closest('.slider, .segmented, input, textarea, [data-no-sheet-drag]')) return;
      const t = e.touches[0];
      s.drag = { y0: t.clientY, x0: t.clientX, p0: s.pos!.value, mode: 'undecided' };
    };
    const move = (e: TouchEvent) => {
      const d = s.drag;
      if (!d || s.closing) return;
      const t = e.touches[0];
      const dy = t.clientY - d.y0;
      const dx = t.clientX - d.x0;
      if (d.mode === 'undecided') {
        if (dx === 0 && dy === 0) return;
        const maxH = s.heights[s.heights.length - 1];
        if (Math.abs(dx) > Math.abs(dy)) d.mode = 'scroll';
        else if (dy > 0 && el.scrollTop <= 0) d.mode = 'sheet';
        else if (dy < 0 && s.pos!.value < maxH - 1) d.mode = 'sheet';
        else d.mode = 'scroll';
        if (d.mode === 'sheet') {
          s.pos!.stop();
          d.p0 = s.pos!.value;
          d.y0 = t.clientY - dy;
          s.tracker.reset();
        }
      }
      if (d.mode !== 'sheet') return;
      if (e.cancelable) e.preventDefault();
      s.pos!.set(d.p0 - (t.clientY - d.y0));
      s.tracker.add(0, t.clientY);
    };
    const end = () => {
      const d = s.drag;
      s.drag = null;
      if (d?.mode === 'sheet') release(-s.tracker.velocity().y);
    };
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
    return () => {
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', end);
    };
  }, [mounted]);

  if (!mounted) return null;

  // Header drag with Pointer Events (mouse and touch).
  const hdrDown = (e: PointerEvent) => {
    if (e.button > 0 || (e.target as Element).closest('button')) return;
    const s = st.current;
    if (s.closing) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    s.pos!.stop();
    s.drag = { y0: e.clientY, x0: e.clientX, p0: s.pos!.value, mode: 'sheet' };
    s.tracker.reset();
    s.tracker.add(0, e.clientY);
  };
  const hdrMove = (e: PointerEvent) => {
    const s = st.current;
    if (!s.drag || s.drag.mode !== 'sheet' || e.pointerType === 'touch' && !e.isPrimary) return;
    s.pos!.set(s.drag.p0 - (e.clientY - s.drag.y0));
    s.tracker.add(0, e.clientY);
  };
  const hdrUp = () => {
    const s = st.current;
    if (!s.drag) return;
    s.drag = null;
    release(-s.tracker.velocity().y);
  };

  const p = props;
  return (
    <div ref={layer} class={`sheet-layer${p.modal ? ' modal' : ''}`}>
      <div ref={probe} aria-hidden="true" style={{ position: 'absolute', top: 0, height: 'var(--safe-top)', width: 0, visibility: 'hidden' }} />
      <div ref={dim} class="sheet-dim" onClick={() => p.dismissible !== false && p.onDismiss()} />
      <div
        ref={sheet}
        id={p.id}
        class="sheet glass"
        role="dialog"
        aria-modal={p.modal ? 'true' : undefined}
        aria-label={p.title}
        tabIndex={-1}
        style={{ transform: 'translate3d(0, 120%, 0)' }}
      >
        <div class="sheet-header" onPointerDown={hdrDown} onPointerMove={hdrMove} onPointerUp={hdrUp} onPointerCancel={hdrUp}>
          <span class="sheet-grabber" aria-hidden="true" />
          {p.leading && <div class="sheet-leading">{p.leading}</div>}
          {p.title && <h2 class="sheet-title">{p.title}</h2>}
          {p.trailing && <div class="sheet-trailing">{p.trailing}</div>}
        </div>
        <div ref={body} class="sheet-body">
          {p.children}
        </div>
      </div>
    </div>
  );
}
