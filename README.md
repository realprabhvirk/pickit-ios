# PicKit for iOS

An offline photo editor for iPhone that installs from Safari to the Home Screen and behaves like a first-party app. It's the iPhone companion to [PicKit for Windows](https://github.com/realprabhvirk/pickit): same ideas and data, rebuilt for the web.

- **Private by construction.** Photos never leave the phone. No server, no accounts, no analytics. After the first load the app makes no network requests, and a strict Content Security Policy blocks connections to anywhere else, so that's enforced by the browser, not just promised.
- **Works offline.** Everything, including the WASM image encoders, is precached by a service worker.
- **Originals are never modified.** Every export is a new file.

Target: iPhone 14 Pro (393 x 852 pt @3x), designed for iOS 26 Liquid Glass, degrading cleanly on iOS 17 and 18.

## Status

| Phase | What | State |
|---|---|---|
| 0 | Shell, design system, glass components, picker, stub editor with pinch/pan, PWA, offline proof, CSP | **Done, waiting for device check** |
| 1 | Engine: canvas probe, worker pipeline, undo with spill, export (WASM, target size), Share/Copy/Files, metadata, autosave | Next |
| 2 | Crop, Resize, Rotate/Flip, Markup, Resize For, Compress/Convert, Clipboard, photo switcher | |
| 3 | Blur/pixelate/redact, Keep/Remove brushes, Batch, rename | |
| 4 | Polish, accessibility pass, profiling, stretch goals | |

In Phase 0 the tool sheets show each tool's real controls so the glass, sheets and gestures can be judged on the phone, but they don't edit yet, and each sheet says so. Details is live.

## Build, run, test

Node 22.

```sh
npm install
npm run dev          # http://localhost:5173 (no service worker in dev)
npm run build        # type-checks, builds to dist/, then audits the bundle for foreign URLs
npm run preview      # serves dist/ at http://localhost:4173 with the real service worker
npm test             # unit tests (Vitest)
npm run test:e2e     # end-to-end tests (Playwright) against the production build
```

The e2e suite has two projects with the same iPhone 14 Pro viewport (393 x 852, @3x, touch):

- `webkit-iphone`: the target. Install Playwright's WebKit once: `npx playwright install webkit`.
- `chromium-iphone`: for machines without WebKit: `npx playwright test --project=chromium-iphone`.

What the suite proves: the service worker installs and every precached file (23, including 5 WASM files) is really in the cache; with the network off, a full reload still opens and draws a photo and all four encoders still run; through a whole session the app requests nothing from any other origin; the CSP in the page matches `public/_headers`; damaged and fake files fail with a message instead of hanging; a 24 MP photo is reduced and the app says so; the back gesture closes the top layer. It also saves light and dark screenshots to `test-results/screenshots/` for review.

What it can't prove: Linux browsers aren't iOS Safari. Glass rendering, the share sheet, haptics, the status bar, Dynamic Island insets and real canvas memory limits need the phone. See [docs/DEVICE-CHECK.md](docs/DEVICE-CHECK.md).

`npm run assets` regenerates the icons and launch images from `src/assets/app-icon/icon.svg`. `node scripts/make-fixtures.mjs` regenerates the synthetic test photos.

## Deploy (Cloudflare Pages)

1. In Cloudflare: **Workers & Pages > Create > Pages > Connect to Git**, and pick this repository.
2. Build settings:
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Environment variable: `NODE_VERSION` = `22`
3. Save and deploy. No Functions or Workers are used; it's static files only. `public/_headers` sets the CSP, `nosniff`, `no-referrer`, a locked-down `Permissions-Policy`, `no-cache` on `index.html`, `sw.js` and the manifest, and a year of immutable caching on hashed `/assets/*`.

### Add to Home Screen on iPhone

1. Open the site in Safari.
2. Tap **Share**. On iOS 26 it's in the **•••** menu next to the address bar.
3. Scroll down and tap **Add to Home Screen** (under **View More** if it isn't listed).
4. On iOS 26, leave **Open as Web App** switched on, then tap **Add**.

PicKit shows these steps itself, once, the first time it's opened in a Safari tab. Installed apps are also exempt from Safari's 7-day storage eviction, which matters for settings and saved sessions.

## How it's put together

| Folder | Purpose |
|---|---|
| `src/design` | Tokens (system colours, type scale, geometry), the Liquid Glass recipe, springs |
| `src/ui` | Hand-built iOS components: Button, Toolbar, Sheet, Segmented, Switch, Slider, List, NavScreen, Menu, Alert, Toast, Icon |
| `src/app` | Shell: screen stack, back navigation, service worker registration, install help, tilt |
| `src/engine` | Decoding, the canvas view, view transform, legibility sampling, codecs, presets |
| `src/screens` | Picker, Editor, Settings, Offline, About, Batch |
| `src/store` | IndexedDB settings (sessions and spilled undo arrive in Phase 1) |
| `src/sw.ts` | The service worker |

Decisions worth knowing:

- **Preact + signals, no UI kit.** Every control is hand-built CSS. Off-the-shelf iOS kits imitate older iOS and fight the Liquid Glass look.
- **Glass is an approximation.** WebKit can't refract the page (`backdrop-filter: url()` is Chromium-only), so glass is blur, saturation and brightness, an edge light from inset shadows, a 0.5 pt gradient rim and a specular sheen that can follow device tilt. Glass is only used for chrome floating over content, never nested, and never with an animated blur. Under Increase Contrast, Reduce Transparency, or without `backdrop-filter`, it becomes opaque with the same shapes.
- **Glass stays legible over any photo.** After each gesture settles, the editor samples the photo's luminance behind each control and picks white or black glyphs plus the least scrim that reaches 4.5:1.
- **The canvas is viewport-sized.** The photo is drawn into a canvas the size of the screen, from half-size copies when zoomed out, so a huge photo never needs a second full-size canvas. Same idea as the Windows app's `DisplayPyramid`.
- **Springs everywhere, interruptible.** Sheets, screens and the photo animate with springs that start from the live position and velocity, so they can be grabbed mid-flight. Flicks project their resting point; edges rubber-band. Reduce Motion swaps them for short fades.
- **Big photos get an honest working copy.** iOS has historically capped a canvas at about 16.7 MP, and a 48 MP iPhone photo can silently render blank. Phase 0 keeps the working copy under that and says so; Phase 1 probes the real limit on the device.
- **Single-threaded WASM.** No SharedArrayBuffer, so no COOP/COEP needed. OxiPNG is imported from its single-thread build so the threaded one is never bundled.
- **Status bar.** `black-translucent` lets the editor run under the Dynamic Island. iOS draws that status bar text white in both appearances, so light screens get a dark scrim behind it. If it looks wrong on the device, switching to `default` is one line in `vite.config.ts` (then re-add to Home Screen).

### Icons and fonts

The icons are original SVG drawings made for PicKit in the visual style of SF Symbols (regular weight, round caps and joins, one sprite). SF Symbols and SF Pro are licensed for Apple platforms only, so neither is bundled. Text uses `-apple-system`, which is SF Pro on the iPhone.

## Licence

MIT. See [LICENSE](LICENSE) and [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
