/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

/**
 * iOS reads this once, when the Home Screen app launches.
 *  - 'black-translucent': content runs under the status bar and Dynamic Island. Text is white in
 *    both appearances, so light screens get a scrim behind it (see .status-scrim in base.css).
 *  - 'default': iOS draws an opaque bar and picks the text colour; content starts below it.
 * Changing it needs a rebuild and a fresh Add to Home Screen.
 */
const STATUS_BAR_STYLE: 'black-translucent' | 'default' = 'black-translucent';

function statusBarStyle(): Plugin {
  return {
    name: 'pickit-status-bar-style',
    transformIndexHtml: (html) => html.replaceAll('%STATUS_BAR_STYLE%', STATUS_BAR_STYLE),
  };
}

/** The same policy as public/_headers. `frame-ancestors` only works as a header, so it stays there. */
export const CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' blob: data:; connect-src 'self'; worker-src 'self' blob:; manifest-src 'self'; base-uri 'none'";

/** Built pages also carry the policy in a meta tag, so it holds on any static host, not only Cloudflare. */
function metaCsp(): Plugin {
  return {
    name: 'pickit-meta-csp',
    apply: 'build',
    transformIndexHtml: (html) =>
      html.replace('<meta charset="utf-8" />', `<meta charset="utf-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
  };
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __STATUS_BAR_STYLE__: JSON.stringify(STATUS_BAR_STYLE),
  },
  plugins: [
    preact(),
    statusBarStyle(),
    metaCsp(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectRegister: false,
      manifestFilename: 'manifest.webmanifest',
      // The glob below already covers the icons and the manifest; don't add them twice.
      includeManifestIcons: false,
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,wasm,json,txt}'],
        // The WebP and MozJPEG encoders are a few hundred KB each; leave plenty of headroom.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      },
      manifest: {
        id: '/',
        name: 'PicKit',
        short_name: 'PicKit',
        description: 'Crop, resize, mark up, compress and clean up photos. Works offline, and nothing leaves your iPhone.',
        lang: 'en',
        dir: 'ltr',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        background_color: '#FFFFFF',
        theme_color: '#FFFFFF',
        categories: ['photo', 'utilities', 'productivity'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    target: ['safari17', 'es2022'],
    assetsInlineLimit: 0,
    sourcemap: false,
    reportCompressedSize: false,
  },
  worker: { format: 'es' },
  optimizeDeps: {
    exclude: ['@jsquash/jpeg', '@jsquash/png', '@jsquash/oxipng', '@jsquash/webp'],
  },
  server: { host: true },
  preview: { host: true },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
