import { signal } from '@preact/signals';
import { registerSW } from 'virtual:pwa-register';
import { showToast } from './overlays';

export type OfflineState =
  | { status: 'unsupported' }
  | { status: 'checking' }
  | { status: 'installing' }
  | { status: 'ready'; total: number; wasm: number; bytes: number }
  | { status: 'incomplete'; total: number; cached: number; missing: string[] };

export const offline = signal<OfflineState>({ status: 'checking' });
export const updateWaiting = signal(false);
export const persisted = signal<boolean | null>(null);

let applyUpdate: ((reload?: boolean) => Promise<void>) | null = null;

/** Asks the service worker to check its cache against the precache list. */
export async function verifyOffline(): Promise<OfflineState> {
  if (!('serviceWorker' in navigator)) return (offline.value = { status: 'unsupported' });
  const reg = await navigator.serviceWorker.getRegistration();
  const sw = navigator.serviceWorker.controller ?? reg?.active;
  if (!sw) return (offline.value = { status: 'installing' });
  const result = await new Promise<Record<string, unknown> | null>((resolve) => {
    const ch = new MessageChannel();
    const timer = setTimeout(() => resolve(null), 15000);
    ch.port1.onmessage = (e) => {
      clearTimeout(timer);
      resolve(e.data as Record<string, unknown>);
    };
    sw.postMessage({ type: 'PICKIT_VERIFY' }, [ch.port2]);
  });
  if (!result || 'error' in result) return (offline.value = { status: 'installing' });
  const r = result as { total: number; cached: number; wasmTotal: number; wasmCached: number; bytes: number; missing: string[] };
  if (r.total > 0 && r.cached === r.total && r.wasmCached === r.wasmTotal) {
    offline.value = { status: 'ready', total: r.total, wasm: r.wasmTotal, bytes: r.bytes };
  } else {
    offline.value = { status: 'incomplete', total: r.total, cached: r.cached, missing: r.missing };
  }
  return offline.value;
}

export function startPwa() {
  if (!('serviceWorker' in navigator)) {
    offline.value = { status: 'unsupported' };
    return;
  }
  applyUpdate = registerSW({
    immediate: true,
    onNeedRefresh() {
      updateWaiting.value = true;
      showUpdateToast();
    },
    onOfflineReady() {
      void verifyOffline();
    },
    onRegisteredSW(_url, reg) {
      // Check the precache once installed, and look for updates when the app comes back to the front.
      if (reg?.active) void verifyOffline();
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void reg?.update().catch(() => {});
      });
    },
    onRegisterError() {
      offline.value = { status: 'unsupported' };
    },
  });
  navigator.serviceWorker.addEventListener('controllerchange', () => void verifyOffline());

  void requestPersistence();
}

function showUpdateToast() {
  showToast({
    icon: 'arrow-down-circle',
    title: 'Update ready',
    subtitle: 'Applies when you tap Update or next launch.',
    duration: 0,
    action: { label: 'Update', onPress: () => void applyUpdate?.(true) },
  });
}

/** Re-shows the update toast (e.g. from Settings). */
export function offerUpdate() {
  if (updateWaiting.value) showUpdateToast();
}

/** Ask iOS to keep our storage. Shown in Settings; nothing depends on it. */
export async function requestPersistence() {
  try {
    if (!navigator.storage?.persist) return (persisted.value = null);
    const already = await navigator.storage.persisted?.();
    persisted.value = already ? true : await navigator.storage.persist();
  } catch {
    persisted.value = null;
  }
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    return e ? { usage: e.usage ?? 0, quota: e.quota ?? 0 } : null;
  } catch {
    return null;
  }
}
