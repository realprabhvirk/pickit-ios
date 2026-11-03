import { useEffect, useRef, useState } from 'preact/hooks';
import { currentImage } from '../app/editorState';
import { pushScreen, topScreen } from '../app/nav';
import { openMenu, showAlert, showToast } from '../app/overlays';
import { isStandalone } from '../app/env';
import { openInstallHelp } from '../app/installHelp';
import { decodeFile, ImageOpenError } from '../engine/decode';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import './picker.css';

function nameFor(file: File | Blob, fallback: string) {
  return file instanceof File && file.name ? file.name : fallback;
}

/** Opens the first image of a selection (the photo switcher for several arrives in Phase 2). */
async function openFiles(files: (File | Blob)[], setBusy: (b: boolean) => void) {
  const images = files.filter((f) => !f.type || f.type.startsWith('image/'));
  if (!images.length) {
    await showAlert("This file can't be opened", "It doesn't look like an image.", [{ label: 'OK', style: 'preferred' }]);
    return;
  }
  setBusy(true);
  try {
    const first = images[0];
    const decoded = await decodeFile(first, nameFor(first, 'Pasted Image'));
    currentImage.value?.bitmap.close();
    currentImage.value = decoded;
    pushScreen('editor');
    if (images.length > 1) {
      showToast({ icon: 'photo-stack', title: 'Opened the first photo', subtitle: 'Editing several at once arrives in Phase 2.', duration: 3200 });
    }
  } catch (e) {
    setBusy(false);
    const err = e instanceof ImageOpenError ? e : new ImageOpenError("This file can't be opened.");
    await showAlert(err.message.replace(/\.$/, ''), err.detail ?? 'It may be damaged or in a format this iPhone can’t read.', [
      { label: 'OK', style: 'preferred' },
    ]);
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
        void openFiles(files, setBusy);
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
          await openFiles([blob], setBusy);
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
        if (files.length) void openFiles(files, setBusy);
      }}
    >
      <div class="scroll picker-scroll">
        <div class="nav-scroll-top" />
        <h1 class="large-title t-large-title">PicKit</h1>
        <div class="picker-empty">
          <div class="picker-empty-art" aria-hidden="true">
            <Icon name="photo-stack" />
          </div>
          <h2 class="t-title2 t-emph">No Photo Open</h2>
          <p class="t-subheadline t-secondary picker-empty-text">
            Choose a photo to crop, resize, mark up, compress or clean up. It never leaves this iPhone.
          </p>
        </div>
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
          if (files.length) void openFiles(files, setBusy);
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
