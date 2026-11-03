import { createPortal } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import type { CanvasView } from '../engine/canvasView';
import { dragCrop, snapToEdges, type CropHandle, type Rect } from '../engine/geometry';

interface Props {
  view: CanvasView;
  root: HTMLElement;
  rect: Rect;
  onChange: (r: Rect) => void;
  aspect?: number;
  imageW: number;
  imageH: number;
  /** Fixed shape that can only be moved (Resize For). */
  moveOnly?: boolean;
  grid?: boolean;
}

const HANDLES: CropHandle[] = ['tl', 't', 'tr', 'r', 'br', 'b', 'bl', 'l'];

/**
 * Crop frame over the photo: dimmed outside, rule-of-thirds grid, corner and edge handles
 * with 44 pt touch areas, edges that snap to the photo's edges. Lives in the DOM so the
 * handles stay crisp and accessible; follows the view as you zoom and pan.
 */
export function CropOverlay({ view, root, rect, onChange, aspect, imageW, imageH, moveOnly, grid = true }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const rectRef = useRef(rect);
  rectRef.current = rect;
  const drag = useRef<{ handle: CropHandle; x0: number; y0: number; start: Rect } | null>(null);

  const place = () => {
    const el = box.current;
    if (!el) return;
    const r = rectRef.current;
    const v = view.imageRectToView(r.x, r.y, r.w, r.h);
    el.style.transform = `translate3d(${v.x}px, ${v.y}px, 0)`;
    el.style.width = `${Math.max(1, v.w)}px`;
    el.style.height = `${Math.max(1, v.h)}px`;
  };

  useEffect(() => view.subscribe(place), [view]);
  useEffect(() => {
    place();
    view.requestRender();
  }, [rect]);

  // Dim the photo outside the frame (drawn on the canvas, so the chrome above isn't dimmed).
  useEffect(
    () =>
      view.addOverlay((ctx) => {
        const r = rectRef.current;
        ctx.fillStyle = 'rgba(0,0,0,0.52)';
        ctx.beginPath();
        ctx.rect(0, 0, imageW, imageH);
        ctx.rect(r.x, r.y, r.w, r.h);
        ctx.fill('evenodd');
      }),
    [view, imageW, imageH],
  );

  const down = (handle: CropHandle) => (e: PointerEvent) => {
    if (moveOnly && handle !== 'move') return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { handle, x0: e.clientX, y0: e.clientY, start: rectRef.current };
  };
  const move = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const z = view.vt.zoom;
    const dx = (e.clientX - d.x0) / z;
    const dy = (e.clientY - d.y0) / z;
    let next = dragCrop(d.start, d.handle, dx, dy, aspect, imageW, imageH);
    if (!aspect && d.handle !== 'move') next = snapToEdges(next, imageW, imageH, 8 / z);
    onChange(next);
  };
  const up = () => {
    drag.current = null;
  };

  const nudge = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 1;
    const k = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!k) return;
    e.preventDefault();
    onChange(dragCrop(rectRef.current, 'move', k[0] / view.vt.zoom, k[1] / view.vt.zoom, aspect, imageW, imageH));
  };

  return createPortal(
    <div
      ref={box}
      class="crop-box"
      role="group"
      tabIndex={0}
      aria-label={`Crop area, ${Math.round(rect.w)} by ${Math.round(rect.h)} pixels. Arrow keys move it.`}
      onKeyDown={nudge}
      onPointerDown={down('move')}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    >
      {grid && (
        <div class="crop-grid" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </div>
      )}
      {!moveOnly &&
        HANDLES.map((h) => (
          <span class={`crop-handle h-${h}`} aria-hidden="true" onPointerDown={down(h)} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
            <i />
          </span>
        ))}
    </div>,
    root,
  );
}
