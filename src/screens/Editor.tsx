import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { currentImage } from '../app/editorState';
import { popScreen } from '../app/nav';
import { showToast } from '../app/overlays';
import { CanvasView } from '../engine/canvasView';
import { formatMP } from '../engine/decode';
import { Button, GlassGroup } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { pressHandlers } from '../ui/press';
import { Sheet } from '../ui/Sheet';
import { Toolbar, type ToolItem } from '../ui/Toolbar';
import { springAnimate, springs } from '../design/motion';
import { ToolPreview, toolTitle, type ToolId } from './ToolSheets';
import { DetailsSheet } from './DetailsSheet';
import './editor.css';

const TOOLS: ToolItem<ToolId>[] = [
  { id: 'crop', icon: 'crop', label: 'Crop' },
  { id: 'resize', icon: 'resize', label: 'Resize' },
  { id: 'rotate', icon: 'rotate', label: 'Rotate' },
  { id: 'markup', icon: 'markup', label: 'Markup' },
  { id: 'privacy', icon: 'privacy', label: 'Privacy' },
  { id: 'background', icon: 'background', label: 'Background' },
  { id: 'compress', icon: 'compress', label: 'Compress' },
  { id: 'resizeFor', icon: 'resize-for', label: 'Resize For' },
  { id: 'details', icon: 'details', label: 'Details' },
];

/** Gap kept between the photo and the floating chrome when fitted. */
const TOP_CHROME = 56;
const BOTTOM_CHROME = 64 + 12;

export function Editor() {
  const img = currentImage.value;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const view = useRef<CanvasView | null>(null);
  const toolbarEl = useRef<HTMLDivElement | null>(null);
  const closeEl = useRef<HTMLDivElement>(null);
  const nameEl = useRef<HTMLDivElement>(null);
  const actionsEl = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const [tool, setTool] = useState<ToolId | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [originY, setOriginY] = useState<number | undefined>(undefined);
  const [zoomText, setZoomText] = useState('');
  const insetBase = useRef({ top: 0, bottom: 0 });

  /** Measure safe areas once mounted; they feed the fit insets. */
  const baseInsets = () => {
    const r = root.current!;
    const probe = r.querySelector<HTMLElement>('.safe-probe')!;
    return { top: probe.offsetTop + TOP_CHROME, bottom: probe.offsetHeight + BOTTOM_CHROME };
  };

  const resample = (v: CanvasView) => {
    const host = root.current;
    if (!host) return;
    const hr = host.getBoundingClientRect();
    const els = [closeEl.current, nameEl.current, actionsEl.current, toolbarEl.current].filter(Boolean) as HTMLElement[];
    const regions = els.map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left - hr.left, y: r.top - hr.top, w: r.width, h: r.height };
    });
    const tones = v.sampleTones(regions, 0.1);
    els.forEach((el, i) => {
      // Glass groups put data-tone on their own root; plain wrappers pass it to the child.
      const target = el.classList.contains('glass') ? el : (el.firstElementChild as HTMLElement | null) ?? el;
      target.dataset.tone = tones[i].tone;
      target.style.setProperty('--glass-alpha', String(tones[i].alpha));
      target.style.setProperty('--glass-shade', tones[i].tone === 'light' ? '0 0 0' : '40 40 60');
    });
  };

  useLayoutEffect(() => {
    const c = canvasRef.current;
    if (!c || !img) return;
    const v = new CanvasView(c, {
      onSettle: resample,
      onChange: (cv) => setZoomText(`${cv.vt.percent}%`),
    });
    view.current = v;
    const b = baseInsets();
    insetBase.current = b;
    v.vt.setInsets({ top: b.top, bottom: b.bottom, left: 0, right: 0 });
    v.setImage(img.bitmap);
    if (img.reduced) {
      showToast({
        icon: 'details',
        title: `Reduced to ${formatMP(img.width, img.height)} for editing`,
        subtitle: `The original is ${formatMP(img.originalWidth, img.originalHeight)}. It isn't changed.`,
        duration: 5200,
      });
    }
    return () => {
      v.destroy();
      view.current = null;
    };
  }, [img]);

  useEffect(() => {
    const onResize = () => {
      if (!root.current) return;
      insetBase.current = baseInsets();
      if (!sheetOpen) view.current?.setInsets({ ...insetBase.current, left: 0, right: 0 });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [sheetOpen]);

  const openTool = (id: ToolId) => {
    const host = root.current!.getBoundingClientRect();
    const tb = toolbarEl.current!.getBoundingClientRect();
    setOriginY(tb.top - host.top);
    setTool(id);
    setSheetOpen(true);
    // The toolbar gives way to the sheet that grows out of it.
    springAnimate(toolbarEl.current!, [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.94) translateY(6px)' }], springs.smooth);
    toolbarEl.current!.setAttribute('aria-hidden', 'true');
  };

  const closeTool = () => setSheetOpen(false);

  const onSheetClosed = () => {
    setTool(null);
    const tb = toolbarEl.current;
    if (tb) {
      tb.removeAttribute('aria-hidden');
      springAnimate(tb, [{ opacity: 0, transform: 'scale(0.94) translateY(6px)' }, { opacity: 1, transform: 'scale(1)' }], springs.default);
    }
    view.current?.setInsets({ ...insetBase.current, left: 0, right: 0 });
  };

  if (!img) return null;

  return (
    <div ref={root} class="screen editor" role="region" aria-label="Editor">
      <div class="safe-probe" aria-hidden="true" />
      <canvas
        ref={canvasRef}
        class="editor-canvas"
        tabIndex={0}
        role="img"
        aria-label={`${img.name}, ${img.width} by ${img.height} pixels. Pinch or use plus and minus to zoom, arrow keys to move, 0 to fit.`}
      />
      <div class="status-scrim on-light" />

      <header class="editor-top">
        <div ref={closeEl}>
          <Button icon="xmark" aria="Close" circle variant="clear" onClick={() => popScreen()} />
        </div>
        <div ref={nameEl} class="editor-name glass clear" role="heading" aria-level={1}>
          <span class="editor-name-text">{img.name}</span>
          <span class="editor-zoom t-num" aria-live="off">
            {zoomText}
          </span>
        </div>
        <div ref={actionsEl}>
          <GlassGroup
            clear
            buttons={[
              { icon: 'undo', aria: 'Undo', disabled: true },
              { icon: 'redo', aria: 'Redo', disabled: true },
              {
                icon: 'share',
                aria: 'Share or export',
                onClick: () =>
                  showToast({ icon: 'share', title: 'Export arrives in Phase 1', subtitle: 'Share, Copy and Save to Files.', duration: 2600 }),
              },
            ]}
          />
        </div>
      </header>

      <Toolbar items={TOOLS} active={tool} onSelect={openTool} toolbarRef={(el) => (toolbarEl.current = el)} label="Editing tools" />

      <Sheet
        open={sheetOpen}
        onDismiss={closeTool}
        onClosed={onSheetClosed}
        title={tool ? toolTitle(tool) : ''}
        originY={originY}
        leading={
          <button type="button" class="sheet-btn" aria-label={tool === 'details' ? 'Done' : 'Cancel'} onClick={closeTool} {...pressHandlers()}>
            <Icon name="xmark" />
          </button>
        }
        trailing={
          tool !== 'details' ? (
            <button type="button" class="sheet-btn confirm" aria-label="Apply" onClick={closeTool} {...pressHandlers()}>
              <Icon name="checkmark" />
            </button>
          ) : undefined
        }
        onVisibleHeight={(h) => {
          const v = view.current;
          if (!v || !tool) return;
          // Keep the photo fitted above the sheet as it moves.
          v.setInsets({ top: insetBase.current.top, bottom: Math.max(insetBase.current.bottom, h + 12), left: 0, right: 0 }, true);
        }}
      >
        {tool === 'details' ? <DetailsSheet img={img} /> : tool ? <ToolPreview tool={tool} /> : null}
      </Sheet>
    </div>
  );
}
