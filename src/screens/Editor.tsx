import { signal } from '@preact/signals';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { activeDoc, activeId, closeDoc, docs } from '../app/docs';
import { popScreen } from '../app/nav';
import { showAlert, showPrompt, showToast } from '../app/overlays';
import { currentTool } from '../app/session';
import { CanvasView } from '../engine/canvasView';
import { formatMP } from '../engine/decode';
import { drawAll } from '../engine/markup';
import { checkName, splitName } from '../engine/rename';
import { GlassGroup } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Sheet } from '../ui/Sheet';
import { Toolbar, type ToolItem } from '../ui/Toolbar';
import { pressHandlers } from '../ui/press';
import { springAnimate, springs } from '../design/motion';
import { TOOL_TITLES, type ToolActions, type ToolHost, type ToolId } from '../tools/host';
import { CropTool } from '../tools/CropTool';
import { ResizeTool } from '../tools/ResizeTool';
import { RotateTool } from '../tools/RotateTool';
import { MarkupTool, hiddenMarkupId } from '../tools/MarkupTool';
import { PrivacyTool } from '../tools/PrivacyTool';
import { BackgroundTool } from '../tools/BackgroundTool';
import { ExportTool } from '../tools/ExportTool';
import { ResizeForTool } from '../tools/ResizeForTool';
import { DetailsTool } from '../tools/DetailsTool';
import { Switcher, pickMore } from './Switcher';
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

/** A tool to reopen once the editor appears (after Resume). */
export const pendingTool = signal<ToolId | null>(null);

const TOP_CHROME = 56;
const BOTTOM_CHROME = 64 + 12;

export function Editor() {
  const doc = activeDoc.value;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const view = useRef<CanvasView | null>(null);
  const toolbarEl = useRef<HTMLDivElement | null>(null);
  const closeEl = useRef<HTMLDivElement>(null);
  const nameEl = useRef<HTMLButtonElement>(null);
  const actionsEl = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const [tool, setTool] = useState<ToolId | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [switcher, setSwitcher] = useState(false);
  const [originY, setOriginY] = useState<number | undefined>(undefined);
  const [zoomText, setZoomText] = useState('');
  const [, force] = useState(0);
  const actions = useRef<ToolActions>({});
  const insetBase = useRef({ top: 0, bottom: 0 });
  const docRef = useRef(doc);
  docRef.current = doc;
  const shown = useRef<{ id: string | null; raster: HTMLCanvasElement | null; version: number }>({ id: null, raster: null, version: -1 });

  // Re-render when the active photo changes (undo state, name...).
  void doc?.version.value;

  const baseInsets = () => {
    const probe = root.current!.querySelector<HTMLElement>('.safe-probe')!;
    return { top: probe.offsetTop + TOP_CHROME, bottom: probe.offsetHeight + BOTTOM_CHROME };
  };

  // One view for the editor's lifetime; photos are swapped into it.
  useLayoutEffect(() => {
    const v = new CanvasView(canvasRef.current!, {
      onChange: (cv) => setZoomText(`${cv.vt.percent}%`),
    });
    view.current = v;
    insetBase.current = baseInsets();
    v.vt.setInsets({ top: insetBase.current.top, bottom: insetBase.current.bottom, left: 0, right: 0 });
    const removeMarkup = v.addOverlay((ctx) => {
      const d = docRef.current;
      if (!d?.markup.length) return;
      const hidden = hiddenMarkupId.value;
      drawAll(ctx, hidden ? d.markup.filter((e) => e.id !== hidden) : d.markup);
    });
    const onResize = () => {
      if (!root.current) return;
      insetBase.current = baseInsets();
      v.setInsets({ ...insetBase.current, left: 0, right: 0 });
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      removeMarkup();
      v.destroy();
      view.current = null;
    };
  }, []);

  // Show the active photo; follow its edits.
  useEffect(() => {
    const v = view.current;
    if (!v || !doc) return;
    const s = shown.current;
    if (s.id !== doc.id) {
      v.transparent = doc.hasAlpha;
      v.setSource(doc.raster, true);
      shown.current = { id: doc.id, raster: doc.raster, version: doc.rasterVersion };
      if (doc.reduced && !doc.dirty && doc.history.length === 0) {
        showToast({
          icon: 'details',
          title: `Reduced to ${formatMP(doc.width, doc.height)} for editing`,
          subtitle: `The original is ${formatMP(doc.originalWidth, doc.originalHeight)}. It isn't changed.`,
          duration: 5200,
        });
      }
    } else if (tool !== 'background' && (s.raster !== doc.raster || s.version !== doc.rasterVersion)) {
      v.transparent = doc.hasAlpha;
      const sizeChanged = !s.raster || s.raster.width !== doc.raster.width || s.raster.height !== doc.raster.height;
      v.invalidate(doc.raster, { refit: sizeChanged });
      shown.current = { id: doc.id, raster: doc.raster, version: doc.rasterVersion };
    } else {
      v.requestRender();
    }
  }, [doc, doc?.version.value]);

  // Leave the editor when the last photo closes.
  useEffect(() => {
    if (!docs.value.length) popScreen();
  }, [docs.value.length]);

  useEffect(() => {
    if (pendingTool.value && doc) {
      const t = pendingTool.value;
      pendingTool.value = null;
      setTimeout(() => openTool(t), 450);
    }
  }, []);

  const openTool = (id: ToolId) => {
    if (!root.current || !toolbarEl.current) return;
    if (sheetOpen) return;
    const host = root.current.getBoundingClientRect();
    const tb = toolbarEl.current.getBoundingClientRect();
    actions.current = {};
    setOriginY(tb.top - host.top);
    setTool(id);
    setSheetOpen(true);
    currentTool.value = id;
    springAnimate(toolbarEl.current, [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.94) translateY(6px)' }], springs.smooth);
    toolbarEl.current.setAttribute('aria-hidden', 'true');
  };

  const closeTool = async (how: 'apply' | 'cancel') => {
    const a = actions.current;
    try {
      if (how === 'apply' && a.apply) {
        if ((await a.apply()) === false) return;
      }
      if (how === 'cancel') await a.cancel?.();
    } catch (e) {
      showToast({ icon: 'details', title: 'That didn’t work', subtitle: e instanceof Error ? e.message : undefined, duration: 3000 });
    }
    setSheetOpen(false);
  };

  const onSheetClosed = () => {
    setTool(null);
    currentTool.value = null;
    hiddenMarkupId.value = null;
    const tb = toolbarEl.current;
    if (tb) {
      tb.removeAttribute('aria-hidden');
      springAnimate(tb, [{ opacity: 0, transform: 'scale(0.94) translateY(6px)' }, { opacity: 1, transform: 'scale(1)' }], springs.default).finished.then(
        (anim) => anim.cancel(),
        () => {},
      );
    }
    view.current?.setInsets({ ...insetBase.current, left: 0, right: 0 });
  };

  const closePhoto = async () => {
    if (!doc) return popScreen();
    if (doc.dirty) {
      const r = await showAlert(`Close “${doc.name}”?`, 'Your edits haven’t been exported, so they’ll be lost. The original photo isn’t affected.', [
        { label: 'Cancel', style: 'cancel' },
        { label: 'Close', style: 'destructive' },
      ]);
      if (r !== 'Close') return;
    }
    closeDoc(doc.id);
  };

  const rename = async () => {
    if (!doc) return;
    const { stem, ext } = splitName(doc.name);
    const next = await showPrompt('Rename', 'This names your exports. The original file keeps its name.', stem, 'Rename');
    if (next === null) return;
    const name = `${next.trim()}${ext}`;
    const problem = checkName(name);
    if (problem) return void showToast({ icon: 'pencil', title: 'Can’t use that name', subtitle: problem, duration: 3000 });
    doc.name = name;
    doc.touch(false);
  };

  const undo = async (redo = false) => {
    if (!doc) return;
    try {
      const step = redo ? await doc.redo() : await doc.undo();
      if (step) showToast({ title: `${redo ? 'Redo' : 'Undo'} ${step.label}`, duration: 1100, dismissible: false });
    } catch {
      showToast({ icon: 'details', title: 'That step can’t be undone', subtitle: 'Its saved copy was cleared.', duration: 3000 });
    }
    force((n) => n + 1);
  };

  const host: ToolHost | null =
    doc && view.current && overlayRef.current
      ? {
          doc,
          view: view.current,
          overlayEl: overlayRef.current,
          setInput: (i) => {
            if (view.current) view.current.input = i;
          },
          addOverlay: (fn) => view.current!.addOverlay(fn),
          render: () => view.current?.requestRender(),
          setActions: (a) => {
            actions.current = a;
            force((n) => n + 1);
          },
          close: () => setSheetOpen(false),
          pxPerPt: () => 1 / (view.current?.vt.zoom || 1),
        }
      : null;

  const toolOwnsUndo = tool === 'background' || tool === 'crop' || tool === 'resize' || tool === 'resizeFor';
  const a = actions.current;
  const textEditing = !!hiddenMarkupId.value;

  return (
    <div ref={root} class={`screen editor${textEditing ? ' text-editing' : ''}`} role="region" aria-label="Editor">
      <div class="safe-probe" aria-hidden="true" />
      <canvas
        ref={canvasRef}
        class="editor-canvas"
        tabIndex={0}
        role="img"
        aria-label={doc ? `${doc.name}, ${doc.width} by ${doc.height} pixels. Pinch or use plus and minus to zoom, arrow keys to move, 0 to fit.` : 'Photo'}
      />
      <div ref={overlayRef} class="tool-overlay" />
      <div class="status-scrim on-light" />

      {doc && (
        <header class="editor-top">
          <div ref={closeEl} class="editor-left">
            <GlassGroup
              buttons={[
                { icon: 'xmark', aria: docs.value.length > 1 ? 'Close this photo' : 'Close', onClick: () => void closePhoto() },
                { icon: 'grid', aria: `All photos, ${docs.value.length} open`, onClick: () => setSwitcher(true) },
              ]}
            />
            {docs.value.length > 1 && (
              <span class="badge t-num" aria-hidden="true">
                {docs.value.length}
              </span>
            )}
          </div>
          <button ref={nameEl} type="button" class="editor-name glass" aria-label={`Rename ${doc.name}`} onClick={() => void rename()} {...pressHandlers()}>
            <span class="editor-name-text">{doc.name}</span>
            <span class="editor-zoom t-num" aria-live="off">
              {zoomText}
            </span>
          </button>
          <div ref={actionsEl}>
            <GlassGroup
              buttons={[
                { icon: 'undo', aria: 'Undo', disabled: !doc.history.canUndo || toolOwnsUndo, onClick: () => void undo(false) },
                { icon: 'redo', aria: 'Redo', disabled: !doc.history.canRedo || toolOwnsUndo, onClick: () => void undo(true) },
                { icon: 'share', aria: 'Export or share', onClick: () => openTool('export') },
              ]}
            />
          </div>
        </header>
      )}

      <Toolbar items={TOOLS} active={tool} onSelect={openTool} toolbarRef={(el) => (toolbarEl.current = el)} label="Editing tools" />

      <Sheet
        open={sheetOpen}
        onDismiss={() => void closeTool('cancel')}
        onClosed={onSheetClosed}
        title={tool ? TOOL_TITLES[tool] : ''}
        originY={originY}
        initial={tool === 'export' || tool === 'compress' || tool === 'details' ? 'large' : 'medium'}
        leading={
          <button type="button" class="sheet-btn" aria-label={a.noApply ? 'Done' : 'Cancel'} onClick={() => void closeTool('cancel')} {...pressHandlers()}>
            <Icon name="xmark" />
          </button>
        }
        trailing={
          !a.noApply ? (
            <button
              type="button"
              class="sheet-btn confirm"
              aria-label="Apply"
              disabled={a.applyDisabled}
              onClick={() => void closeTool('apply')}
              {...pressHandlers()}
            >
              <Icon name="checkmark" />
            </button>
          ) : undefined
        }
        onVisibleHeight={(h) => {
          const v = view.current;
          if (!v || !tool) return;
          v.setInsets({ top: insetBase.current.top, bottom: Math.max(insetBase.current.bottom, h + 12), left: 0, right: 0 }, true);
        }}
      >
        {host && tool && <ToolBody key={`${doc!.id}-${tool}`} tool={tool} host={host} />}
      </Sheet>

      <Switcher
        open={switcher}
        onClose={() => setSwitcher(false)}
        onPick={(id) => {
          activeId.value = id;
          setSwitcher(false);
        }}
        onAdd={() => {
          setSwitcher(false);
          void pickMore();
        }}
      />
    </div>
  );
}

function ToolBody({ tool, host }: { tool: ToolId; host: ToolHost }) {
  switch (tool) {
    case 'crop':
      return <CropTool host={host} />;
    case 'resize':
      return <ResizeTool host={host} />;
    case 'rotate':
      return <RotateTool host={host} />;
    case 'markup':
      return <MarkupTool host={host} />;
    case 'privacy':
      return <PrivacyTool host={host} />;
    case 'background':
      return <BackgroundTool host={host} />;
    case 'compress':
      return <ExportTool host={host} focus="compress" />;
    case 'export':
      return <ExportTool host={host} focus="export" />;
    case 'resizeFor':
      return <ResizeForTool host={host} />;
    case 'details':
      return <DetailsTool host={host} />;
  }
}
