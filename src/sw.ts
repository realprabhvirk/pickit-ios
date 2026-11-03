/// <reference lib="webworker" />
/**
 * PicKit service worker. Precaches the whole app (shell, scripts, styles, icons, launch images
 * and every WASM codec) at install and serves it from the cache from then on. There is no
 * runtime caching because nothing remote is ever fetched.
 *
 * Updates wait. A new version installs in the background and only takes over when the user
 * taps Update (SKIP_WAITING) or on the next cold launch, never in the middle of an edit.
 */
import { cleanupOutdatedCaches, createHandlerBoundToURL, getCacheKeyForURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { cacheNames, clientsClaim } from 'workbox-core';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null } | string> };

const manifest = self.__WB_MANIFEST;

precacheAndRoute(manifest);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')));

// First install takes control straight away so the first visit is already offline-capable.
// Later versions don't call skipWaiting themselves (see SKIP_WAITING below).
clientsClaim();

interface VerifyResult {
  type: 'PICKIT_VERIFY_RESULT';
  total: number;
  cached: number;
  wasmTotal: number;
  wasmCached: number;
  bytes: number;
  missing: string[];
}

/** Checks every precache entry is really in the cache and readable, rather than assuming. */
async function verify(): Promise<VerifyResult> {
  const cache = await caches.open(cacheNames.precache);
  let cached = 0;
  let wasmTotal = 0;
  let wasmCached = 0;
  let bytes = 0;
  const missing: string[] = [];
  for (const entry of manifest) {
    const url = typeof entry === 'string' ? entry : entry.url;
    const isWasm = url.endsWith('.wasm');
    if (isWasm) wasmTotal++;
    const key = getCacheKeyForURL(url);
    const res = key ? await cache.match(key) : undefined;
    if (res && res.ok) {
      const size = (await res.clone().arrayBuffer()).byteLength;
      if (size > 0) {
        cached++;
        bytes += size;
        if (isWasm) wasmCached++;
        continue;
      }
    }
    missing.push(url);
  }
  return { type: 'PICKIT_VERIFY_RESULT', total: manifest.length, cached, wasmTotal, wasmCached, bytes, missing };
}

self.addEventListener('message', (event: ExtendableMessageEvent) => {
  const data = event.data as { type?: string } | undefined;
  if (data?.type === 'SKIP_WAITING') {
    void self.skipWaiting();
  } else if (data?.type === 'PICKIT_VERIFY') {
    const port = event.ports[0];
    event.waitUntil(
      verify()
        .then((r) => port?.postMessage(r))
        .catch((e: unknown) => port?.postMessage({ type: 'PICKIT_VERIFY_RESULT', error: String(e) })),
    );
  } else if (data?.type === 'PICKIT_VERSION') {
    event.ports[0]?.postMessage({ type: 'PICKIT_VERSION_RESULT', entries: manifest.length });
  }
});
