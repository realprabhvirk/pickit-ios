import { useEffect, useRef } from 'preact/hooks';
import { activeId, closeDoc, docs, openFiles, openPixels } from '../app/docs';
import { showAlert, showToast } from '../app/overlays';
import { Sheet } from '../ui/Sheet';
import { Icon } from '../ui/Icon';
import { pressHandlers } from '../ui/press';
import type { Doc } from '../engine/document';

/** Asks for more photos and opens them alongside the ones already open. */
export function pickMore() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.multiple = true;
  input.style.display = 'none';
  input.onchange = async () => {
    const files = [...(input.files ?? [])];
    input.remove();
    if (!files.length) return;
    const r = await openFiles(files);
    reportOpen(r);
  };
  document.body.appendChild(input);
  input.click();
}

export function reportOpen(r: { failed: { name: string; reason: string }[]; skipped: number }) {
  if (r.failed.length) {
    void showAlert(
      r.failed.length === 1 ? `“${r.failed[0].name}” can’t be opened` : `${r.failed.length} files can’t be opened`,
      r.failed.length === 1 ? r.failed[0].reason : r.failed.map((f) => f.name).join(', '),
      [{ label: 'OK', style: 'preferred' }],
    );
  }
  if (r.skipped) {
    showToast({
      icon: 'photo-stack',
      title: `${r.skipped} photo${r.skipped === 1 ? '' : 's'} not opened`,
      subtitle: 'Close some photos first: this iPhone’s memory for open photos is full.',
      duration: 4200,
    });
  }
}

function Thumb({ doc }: { doc: Doc }) {
  const c = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = c.current!;
    const k = Math.min(1, 300 / Math.max(doc.width, doc.height));
    el.width = Math.max(1, Math.round(doc.width * k));
    el.height = Math.max(1, Math.round(doc.height * k));
    const x = el.getContext('2d')!;
    x.imageSmoothingQuality = 'high';
    x.drawImage(doc.raster, 0, 0, el.width, el.height);
    return () => {
      el.width = el.height = 0;
    };
  }, [doc, doc.rasterVersion]);
  return <canvas ref={c} class="switch-thumb" aria-hidden="true" />;
}

/** All open photos, like Safari's tab overview. Each keeps its own edits and undo. */
export function Switcher({ open, onClose, onPick, onAdd }: { open: boolean; onClose: () => void; onPick: (id: string) => void; onAdd: () => void }) {
  const list = docs.value;
  const close = async (d: Doc) => {
    if (d.dirty) {
      const r = await showAlert(`Close “${d.name}”?`, 'Its edits haven’t been exported, so they’ll be lost.', [
        { label: 'Cancel', style: 'cancel' },
        { label: 'Close', style: 'destructive' },
      ]);
      if (r !== 'Close') return;
    }
    closeDoc(d.id);
  };
  return (
    <Sheet open={open} onDismiss={onClose} title={`${list.length} Photo${list.length === 1 ? '' : 's'}`} detents={['large']} initial="large" modal id="switcher">
      <div class="switch-grid">
        {list.map((d) => (
          <div class={`switch-card${d.id === activeId.value ? ' current' : ''}`}>
            <button type="button" class="switch-open" aria-label={`Edit ${d.name}`} onClick={() => onPick(d.id)} {...pressHandlers()}>
              <span class="switch-frame">
                <Thumb doc={d} />
              </span>
              <span class="switch-name">{d.name}</span>
              <span class="switch-meta t-num">
                {d.width} × {d.height}
                {d.dirty ? ' · edited' : ''}
              </span>
            </button>
            <button type="button" class="switch-close" aria-label={`Close ${d.name}`} onClick={() => void close(d)}>
              <Icon name="xmark" />
            </button>
          </div>
        ))}
        <button type="button" class="switch-card switch-add" onClick={onAdd} aria-label="Add photos" {...pressHandlers()}>
          <span class="switch-frame">
            <Icon name="plus" />
          </span>
          <span class="switch-name">Add Photos</span>
          <span class="switch-meta t-num">{Math.round(openPixels() / 1e6)} MP open</span>
        </button>
      </div>
    </Sheet>
  );
}
