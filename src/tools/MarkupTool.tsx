import { createPortal } from 'preact';
import { signal } from '@preact/signals';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ToolHost } from './host';
import {
  FONTS,
  bounds,
  drawElement,
  elementAt,
  erase,
  moveEl,
  newId,
  type MarkupEl,
  type MarkupKind,
  type TextEl,
  type TextFont,
} from '../engine/markup';
import { Slider } from '../ui/Slider';
import { Icon, type IconName } from '../ui/Icon';
import { haptic } from '../ui/haptics';

/** The element being edited as text is hidden from the canvas while its field is open. */
export const hiddenMarkupId = signal<string | null>(null);

type Mode = 'select' | MarkupKind | 'eraser';

const MODES: { id: Mode; icon: IconName; label: string }[] = [
  { id: 'select', icon: 'select', label: 'Select' },
  { id: 'pen', icon: 'pencil', label: 'Pen' },
  { id: 'highlight', icon: 'highlighter', label: 'Highlighter' },
  { id: 'arrow', icon: 'arrow', label: 'Arrow' },
  { id: 'line', icon: 'line', label: 'Line' },
  { id: 'rect', icon: 'square', label: 'Rectangle' },
  { id: 'ellipse', icon: 'circle', label: 'Ellipse' },
  { id: 'text', icon: 'text', label: 'Text' },
  { id: 'eraser', icon: 'eraser', label: 'Eraser' },
];

export const SWATCHES = [
  { c: '#000000', n: 'Black' },
  { c: '#FFFFFF', n: 'White' },
  { c: '#FF3B30', n: 'Red' },
  { c: '#FF9500', n: 'Orange' },
  { c: '#FFCC00', n: 'Yellow' },
  { c: '#34C759', n: 'Green' },
  { c: '#007AFF', n: 'Blue' },
  { c: '#AF52DE', n: 'Purple' },
];

const DEFAULT_WIDTH: Partial<Record<Mode, number>> = { pen: 4, highlight: 18, arrow: 5, line: 5, rect: 4, ellipse: 4, text: 28, eraser: 18 };

export function MarkupTool({ host }: { host: ToolHost }) {
  const { doc, view } = host;
  const [mode, setMode] = useState<Mode>('pen');
  const [color, setColor] = useState('#FF3B30');
  const [widths, setWidths] = useState<Partial<Record<Mode, number>>>(DEFAULT_WIDTH);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<TextEl | null>(null);
  const start = useRef(doc.history.length);
  const draft = useRef<MarkupEl | null>(null);
  const state = useRef({ mode, color, widths, selected });
  state.current = { mode, color, widths, selected };

  const width = widths[mode] ?? 4;
  const ptToPx = () => host.pxPerPt();

  // Draft element and selection outline, drawn over the photo.
  useEffect(
    () =>
      host.addOverlay((ctx) => {
        if (draft.current) drawElement(ctx, draft.current);
        const sel = state.current.selected && doc.markup.find((e) => e.id === state.current.selected);
        if (sel) {
          const b = bounds(sel);
          const k = 1 / view.vt.zoom / view.vt.dpr;
          ctx.lineWidth = 1.5 * k * view.vt.dpr;
          ctx.setLineDash([5 * k * view.vt.dpr, 4 * k * view.vt.dpr]);
          ctx.strokeStyle = '#0A84FF';
          ctx.strokeRect(b.x - 6 * k * view.vt.dpr, b.y - 6 * k * view.vt.dpr, b.w + 12 * k * view.vt.dpr, b.h + 12 * k * view.vt.dpr);
        }
      }),
    [],
  );

  const commit = (label: string, next: MarkupEl[]) => {
    doc.setMarkup(label, next);
    haptic();
  };

  const beginText = (at: { x: number; y: number }, existing?: TextEl) => {
    const el: TextEl = existing ?? {
      id: newId(),
      kind: 'text',
      style: { color: state.current.color, width: 0 },
      x: at.x,
      y: at.y,
      text: '',
      font: 'system',
      size: (state.current.widths.text ?? 28) * ptToPx(),
    };
    hiddenMarkupId.value = el.id;
    setEditing(el);
    host.render();
  };

  // Canvas input for the current mode.
  useEffect(() => {
    let last: { x: number; y: number } | null = null;
    let before: MarkupEl[] = [];
    let dragging: { id: string; x0: number; y0: number; orig: MarkupEl } | null = null;

    host.setInput({
      down: (p) => {
        const { mode: m, color: c, widths: ws } = state.current;
        const w = (ws[m] ?? 4) * ptToPx();
        const tol = 10 * ptToPx();
        if (m === 'select') {
          const hit = elementAt(doc.markup, p.x, p.y, tol);
          setSelected(hit?.id ?? null);
          host.render();
          if (!hit) return false;
          before = doc.markup;
          dragging = { id: hit.id, x0: p.x, y0: p.y, orig: hit };
          return true;
        }
        if (m === 'text') {
          const hit = elementAt(doc.markup, p.x, p.y, tol);
          if (hit?.kind === 'text') beginText(p, hit);
          else beginText(p);
          return true;
        }
        if (m === 'eraser') {
          before = doc.markup;
          last = p;
          const next = erase(doc.markup, p.x, p.y, p.x, p.y, w / 2);
          if (next !== doc.markup) {
            doc.markup = next;
            host.render();
          }
          return true;
        }
        const style = { color: c, width: w };
        if (m === 'pen' || m === 'highlight') draft.current = { id: newId(), kind: m, style, points: [p.x, p.y, p.pressure] };
        else if (m === 'line' || m === 'arrow') draft.current = { id: newId(), kind: m, style, x1: p.x, y1: p.y, x2: p.x, y2: p.y };
        else draft.current = { id: newId(), kind: m as 'rect' | 'ellipse', style, x: p.x, y: p.y, w: 0, h: 0 };
        last = p;
        host.render();
        return true;
      },
      move: (p) => {
        const m = state.current.mode;
        if (dragging) {
          const moved = moveEl(dragging.orig, p.x - dragging.x0, p.y - dragging.y0);
          doc.markup = doc.markup.map((e) => (e.id === dragging!.id ? moved : e));
          host.render();
          return;
        }
        if (m === 'eraser' && last) {
          const w = (state.current.widths.eraser ?? 18) * ptToPx();
          const next = erase(doc.markup, last.x, last.y, p.x, p.y, w / 2);
          last = p;
          if (next !== doc.markup) {
            doc.markup = next;
            host.render();
          }
          return;
        }
        const d = draft.current;
        if (!d || !last) return;
        if (d.kind === 'pen' || d.kind === 'highlight') {
          // Skip points closer than half a screen point; they add nothing but weight.
          if (Math.hypot(p.x - last.x, p.y - last.y) < 0.5 * ptToPx()) return;
          d.points.push(p.x, p.y, p.pressure);
          last = p;
        } else if (d.kind === 'line' || d.kind === 'arrow') {
          d.x2 = p.x;
          d.y2 = p.y;
        } else if (d.kind === 'rect' || d.kind === 'ellipse') {
          d.x = Math.min(last.x, p.x);
          d.y = Math.min(last.y, p.y);
          d.w = Math.abs(p.x - last.x);
          d.h = Math.abs(p.y - last.y);
        }
        host.render();
      },
      up: () => {
        if (dragging) {
          const after = doc.markup;
          doc.markup = before;
          if (after !== before) commit('Move', after);
          dragging = null;
          return;
        }
        if (state.current.mode === 'eraser') {
          const after = doc.markup;
          doc.markup = before;
          if (after !== before) commit('Erase', after);
          last = null;
          return;
        }
        const d = draft.current;
        draft.current = null;
        last = null;
        if (!d) return;
        const tiny = 2 * ptToPx();
        const big =
          d.kind === 'pen' || d.kind === 'highlight'
            ? true
            : d.kind === 'line' || d.kind === 'arrow'
              ? Math.hypot(d.x2 - d.x1, d.y2 - d.y1) > tiny
              : d.kind === 'rect' || d.kind === 'ellipse'
                ? d.w > tiny && d.h > tiny
                : true;
        if (big) commit('Draw', [...doc.markup, d]);
        host.render();
      },
      cancel: () => {
        if (dragging || state.current.mode === 'eraser') doc.markup = before;
        dragging = null;
        draft.current = null;
        last = null;
        host.render();
      },
    });
    return () => host.setInput(null);
  }, []);

  useEffect(() => {
    host.setActions({
      cancel: async () => {
        hiddenMarkupId.value = null;
        await doc.history.rollback(doc, start.current);
        doc.touch(false);
      },
      apply: () => {
        hiddenMarkupId.value = null;
      },
    });
  }, []);

  // Restyle the selection when colour or width changes.
  const restyle = (patch: { color?: string; width?: number }) => {
    if (!selected) return;
    const el = doc.markup.find((e) => e.id === selected);
    if (!el) return;
    const next = el.kind === 'text' && patch.width !== undefined ? { ...el, size: patch.width * ptToPx() } : { ...el, style: { ...el.style, ...(patch.color ? { color: patch.color } : {}), ...(patch.width !== undefined ? { width: patch.width * ptToPx() } : {}) } };
    commit('Restyle', doc.markup.map((e) => (e.id === selected ? (next as MarkupEl) : e)));
  };

  const selEl = selected ? doc.markup.find((e) => e.id === selected) : null;

  return (
    <div class="tool-body">
      <div class="palette" role="radiogroup" aria-label="Markup tool">
        {MODES.map((m) => (
          <button
            type="button"
            role="radio"
            aria-checked={mode === m.id}
            aria-label={m.label}
            class="palette-btn"
            onClick={() => {
              setMode(m.id);
              if (m.id !== 'select') setSelected(null);
              host.render();
            }}
          >
            <Icon name={m.icon} />
          </button>
        ))}
      </div>

      <div class="swatches" role="radiogroup" aria-label="Colour">
        {SWATCHES.map((s) => (
          <button
            type="button"
            role="radio"
            aria-checked={color.toUpperCase() === s.c}
            aria-label={s.n}
            class="swatch"
            style={{ '--sw': s.c }}
            onClick={() => {
              setColor(s.c);
              restyle({ color: s.c });
            }}
          />
        ))}
        <label class="swatch custom" aria-label="Other colour" style={{ '--sw': color }}>
          <input
            type="color"
            value={color}
            onInput={(e) => {
              const c = (e.currentTarget as HTMLInputElement).value.toUpperCase();
              setColor(c);
            }}
            onChange={(e) => restyle({ color: (e.currentTarget as HTMLInputElement).value.toUpperCase() })}
          />
        </label>
      </div>

      {mode !== 'select' && (
        <>
          <div class="tool-row compact">
            <span>{mode === 'text' ? 'Text Size' : mode === 'eraser' ? 'Eraser Size' : 'Line Width'}</span>
            <span class="t-num tool-value">{width} pt</span>
          </div>
          <Slider
            value={width}
            min={mode === 'text' ? 10 : 1}
            max={mode === 'text' ? 120 : mode === 'highlight' || mode === 'eraser' ? 60 : 30}
            onChange={(v) => setWidths({ ...widths, [mode]: v })}
            label={mode === 'text' ? 'Text size' : 'Line width'}
            valueText={(v) => `${v} points`}
          />
        </>
      )}

      {mode === 'select' && (
        <div class="tool-row">
          <span>{selEl ? `Selected: ${MODES.find((m) => m.id === selEl.kind)?.label ?? 'Markup'}` : 'Tap a drawing to select it, then drag to move.'}</span>
          {selEl && (
            <span class="row-actions">
              {selEl.kind === 'text' && (
                <button type="button" class="link-btn" onClick={() => beginText({ x: 0, y: 0 }, selEl as TextEl)}>
                  Edit
                </button>
              )}
              <button
                type="button"
                class="link-btn destructive"
                onClick={() => {
                  commit('Delete', doc.markup.filter((e) => e.id !== selEl.id));
                  setSelected(null);
                }}
              >
                Delete
              </button>
            </span>
          )}
        </div>
      )}

      <p class="tool-note">
        One finger draws, two fingers move and zoom. Markup stays editable until you export{doc.markup.length ? ` · ${doc.markup.length} item${doc.markup.length === 1 ? '' : 's'}` : ''}.
      </p>

      {editing && (
        <TextEditor
          host={host}
          el={editing}
          onDone={(el) => {
            hiddenMarkupId.value = null;
            setEditing(null);
            const exists = doc.markup.some((e) => e.id === el.id);
            const empty = !el.text.trim();
            if (empty && exists) commit('Delete Text', doc.markup.filter((e) => e.id !== el.id));
            else if (!empty && exists) commit('Edit Text', doc.markup.map((e) => (e.id === el.id ? el : e)));
            else if (!empty) commit('Add Text', [...doc.markup, el]);
            host.render();
          }}
        />
      )}
    </div>
  );
}

/** An inline text field over the photo, matching the text's font, size and colour. */
function TextEditor({ host, el, onDone }: { host: ToolHost; el: TextEl; onDone: (el: TextEl) => void }) {
  const { view } = host;
  const [text, setText] = useState(el.text);
  const [font, setFont] = useState<TextFont>(el.font);
  const [size, setSize] = useState(el.size);
  const field = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);

  const place = () => {
    const f = field.current;
    if (!f) return;
    const p = view.vt.imageToView(el.x, el.y);
    const z = view.vt.zoom;
    f.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`;
    f.style.fontSize = `${size * z}px`;
  };

  useEffect(() => {
    place();
    const un = view.subscribe(place);
    const f = field.current!;
    f.focus({ preventScroll: true });
    // Keep the text above the keyboard.
    const vv = window.visualViewport;
    const ensureVisible = () => {
      const r = f.getBoundingClientRect();
      const limit = (vv?.height ?? window.innerHeight) + (vv?.offsetTop ?? 0) - 80;
      if (r.bottom > limit) {
        view.vt.panBy(0, -(r.bottom - limit), false);
        view.requestRender();
      }
    };
    vv?.addEventListener('resize', ensureVisible);
    setTimeout(ensureVisible, 350);
    return () => {
      un();
      vv?.removeEventListener('resize', ensureVisible);
    };
  }, []);
  useEffect(place, [size]);

  const finish = () => {
    if (done.current) return;
    done.current = true;
    onDone({ ...el, text, font, size });
  };

  const f = FONTS.find((x) => x.id === font) ?? FONTS[0];
  return createPortal(
    <>
      <textarea
        ref={field}
        class="text-field"
        value={text}
        rows={Math.max(1, text.split('\n').length)}
        placeholder="Text"
        aria-label="Text"
        style={{ fontFamily: f.css, fontWeight: f.weight, color: el.style.color }}
        onInput={(e) => setText((e.currentTarget as HTMLTextAreaElement).value)}
        onBlur={() => setTimeout(() => document.activeElement?.closest('.text-bar') || finish(), 50)}
      />
      <div class="text-bar glass" role="toolbar" aria-label="Text options" onPointerDown={(e) => e.preventDefault()}>
        <div class="text-fonts">
          {FONTS.map((x) => (
            <button
              type="button"
              class={`text-font${x.id === font ? ' on' : ''}`}
              style={{ fontFamily: x.css, fontWeight: x.weight }}
              aria-pressed={x.id === font}
              onClick={() => setFont(x.id)}
            >
              {x.name}
            </button>
          ))}
        </div>
        <button type="button" class="text-size" aria-label="Smaller" onClick={() => setSize((s) => Math.max(6, s / 1.15))}>
          A−
        </button>
        <button type="button" class="text-size" aria-label="Larger" onClick={() => setSize((s) => Math.min(2000, s * 1.15))}>
          A+
        </button>
        <button type="button" class="text-done" onClick={finish}>
          Done
        </button>
      </div>
    </>,
    host.overlayEl,
  );
}
