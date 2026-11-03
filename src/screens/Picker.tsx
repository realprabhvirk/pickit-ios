import { useEffect, useRef, useState } from 'preact/hooks';
import { closeAll, docs, openFiles } from '../app/docs';
import { pushScreen, topScreen } from '../app/nav';
import { openMenu, showAlert, showToast } from '../app/overlays';
import { isStandalone } from '../app/env';
import { openInstallHelp } from '../app/installHelp';
import { discardSession, resumeSession, savedSession } from '../app/session';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { pressHandlers } from '../ui/press';
import { pendingTool } from './Editor';
import { reportOpen } from './Switcher';
import type { ToolId } from '../tools/host';
import './picker.css';

function ago(ms: number) {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

const goToEditor = () => {
  if (topScreen() !== 'editor') pushScreen('editor');
};

async function resume() {
  const tool = await resumeSession();
  if (!docs.value.length) {
    showToast({ icon: 'details', title: 'Nothing could be restored', duration: 2600 });
    return;
  }
  if (tool) pendingTool.value = tool as ToolId;
  goToEditor();
}

/** Opens photos; if last session's photos are waiting, asks what to do with them first. */
async function open(files: (File | Blob)[], setBusy: (b: boolean) => void) {
  if (savedSession.value) {
    const n = savedSession.value.index.ids.length;
    const r = await showAlert('Unfinished edits', `You have ${n} photo${n === 1 ? '' : 's'} with unfinished edits from last time.`, [
      { label: 'Keep Them Open Too', style: 'preferred' },
      { label: 'Discard Them', style: 'destructive' },
      { label: 'Cancel', style: 'cancel' },
    ]);
    if (r === 'Cancel' || r === null) return;
    if (r === 'Discard Them') await discardSession();
    else await resumeSession();
  }
  setBusy(true);
  try {
    const r = await openFiles(files);
    reportOpen(r);
    if (r.opened.length) goToEditor();
  } finally {
    setBusy(false);
  }
}

export function Picker() {
  const input = useRef<HTMLInputElement>(null);
  const menuBtn = useRef<HTMLButtonElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  // Paste anywhere while the picker is showing.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (topScreen() !== 'picker') return;
      const files = [...(e.clipboardData?.files ?? [])];
      if (files.length) {
        e.preventDefault();
        void open(files, setBusy);
      }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, []);

  const paste = async () => {
    // Must stay inside the tap: iOS shows its Paste confirmation for this call.
    if (!navigator.clipboard?.read) {
      await showAlert('Paste isn’t available', 'Copy an image, then long-press here and choose Paste.', [{ label: 'OK', style: 'preferred' }]);
      return;
    }
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = item.types.find((t) => t.startsWith('image/'));
        if (type) {
          const blob = await item.getType(type);
          const ext = type.split('/')[1]?.replace('jpeg', 'jpg') ?? 'png';
          await open([new File([blob], `Pasted Image.${ext}`, { type })], setBusy);
          return;
        }
      }
      showToast({ icon: 'paste', title: 'No image on the clipboard', duration: 2200 });
    } catch {
      showToast({ icon: 'paste', title: 'Nothing pasted', subtitle: 'Allow Paste when iOS asks.', duration: 2400 });
    }
  };

  const showMenu = () => {
    if (!menuBtn.current) return;
    openMenu(
      menuBtn.current,
      [
        { label: 'Batch', icon: 'stack', onSelect: () => pushScreen('batch') },
        { label: 'Settings', icon: 'gear', onSelect: () => pushScreen('settings') },
        { label: 'About PicKit', icon: 'details', onSelect: () => pushScreen('about') },
        ...(isStandalone() ? [] : [{ label: 'Add to Home Screen', icon: 'add-home' as const, onSelect: openInstallHelp, separatorBefore: true }]),
      ],
      'More',
    );
  };

  const openNow = docs.value;
  const saved = savedSession.value;

  const closeOpen = async () => {
    const dirty = openNow.filter((d) => d.dirty).length;
    if (dirty) {
      const r = await showAlert(
        `Close ${openNow.length === 1 ? 'this photo' : `all ${openNow.length} photos`}?`,
        `${dirty === 1 ? 'One has' : `${dirty} have`} edits that haven’t been exported. They’ll be lost; your originals aren’t affected.`,
        [
          { label: 'Cancel', style: 'cancel' },
          { label: 'Close', style: 'destructive' },
        ],
      );
      if (r !== 'Close') return;
    }
    closeAll();
  };

  const discard = async () => {
    const r = await showAlert('Discard unfinished edits?', 'The photos from last time will be removed from PicKit. Your originals aren’t affected.', [
      { label: 'Cancel', style: 'cancel' },
      { label: 'Discard', style: 'destructive' },
    ]);
    if (r === 'Discard') await discardSession();
  };

  const card =
    openNow.length > 0
      ? {
          title: 'Continue Editing',
          sub: `${openNow.length} photo${openNow.length === 1 ? '' : 's'} open`,
          thumbs: openNow.slice(0, 4).map((d) => ({ id: d.id, name: d.name, canvas: d.raster })),
          onResume: goToEditor,
          onClose: () => void closeOpen(),
          closeLabel: 'Close photos',
        }
      : saved
        ? {
            title: 'Resume',
            sub: `${saved.thumbs.length} photo${saved.thumbs.length === 1 ? '' : 's'} · edited ${ago(saved.index.savedAt)}`,
            thumbs: saved.thumbs.slice(0, 4).map((t) => ({ id: t.id, name: t.name, url: t.url })),
            onResume: () => void resume(),
            onClose: () => void discard(),
            closeLabel: 'Discard unfinished edits',
          }
        : null;

  return (
    <div
      class="screen picker"
      role="region"
      aria-label="PicKit"
      onDragOver={(e) => {
        if (e.dataTransfer?.types.includes('Files')) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const files = [...(e.dataTransfer?.files ?? [])];
        if (files.length) void open(files, setBusy);
      }}
    >
      <div class="scroll picker-scroll">
        <div class="nav-scroll-top" />
        <h1 class="large-title t-large-title">PicKit</h1>
        {card && (
          <div class="list">
            <section class="section resume" aria-label={card.title}>
              <div class="section-body resume-card">
                <button type="button" class="resume-open" onClick={card.onResume} {...pressHandlers()} id="resume">
                  <span class="resume-thumbs" aria-hidden="true">
                    {card.thumbs.map((t) => ('url' in t && t.url ? <img src={t.url} alt="" /> : <ThumbCanvas src={(t as { canvas: HTMLCanvasElement }).canvas} />))}
                  </span>
                  <span class="resume-text">
                    <span class="t-headline">{card.title}</span>
                    <span class="t-subheadline t-secondary">{card.sub}</span>
                  </span>
                  <Icon name="chevron-right" class="row-chevron" />
                </button>
                <button type="button" class="resume-close" aria-label={card.closeLabel} onClick={card.onClose}>
                  <Icon name="xmark" />
                </button>
              </div>
            </section>
          </div>
        )}
        {!card && (
          <div class="picker-empty">
            <div class="picker-empty-art" aria-hidden="true">
              <Icon name="photo-stack" />
            </div>
            <h2 class="t-title2 t-emph">No Photo Open</h2>
            <p class="t-subheadline t-secondary picker-empty-text">
              Choose photos to crop, resize, mark up, compress or clean up. They never leave this iPhone.
            </p>
          </div>
        )}
      </div>

      <div class="status-scrim on-light" />
      <header class="navbar">
        <div class="navbar-trailing">
          <Button icon="ellipsis" aria="More" circle onClick={showMenu} buttonRef={(el) => (menuBtn.current = el)} aria-haspopup="menu" />
        </div>
      </header>

      <div class="picker-actions">
        <Button
          variant="tinted"
          large
          icon="photo"
          label={busy ? 'Opening…' : 'Choose Photos'}
          class="picker-choose"
          disabled={busy}
          onClick={() => input.current?.click()}
        />
        <Button icon="paste" aria="Paste image" large circle onClick={() => void paste()} disabled={busy} />
      </div>

      <input
        ref={input}
        class="visually-hidden"
        type="file"
        accept="image/*"
        multiple
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const el = e.currentTarget;
          const files = [...(el.files ?? [])];
          el.value = '';
          if (files.length) void open(files, setBusy);
        }}
      />

      {dragging && (
        <div class="drop-overlay" aria-hidden="true">
          <div class="drop-target">
            <Icon name="plus" />
            <span>Drop to Open</span>
          </div>
        </div>
      )}
    </div>
  );
}

function ThumbCanvas({ src }: { src: HTMLCanvasElement }) {
  const c = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = c.current!;
    const k = Math.min(1, 160 / Math.max(src.width, src.height));
    el.width = Math.max(1, Math.round(src.width * k));
    el.height = Math.max(1, Math.round(src.height * k));
    el.getContext('2d')!.drawImage(src, 0, 0, el.width, el.height);
    return () => {
      el.width = el.height = 0;
    };
  }, [src]);
  return <canvas ref={c} />;
}
