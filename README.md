# PicKit for iOS

An offline photo editor for iPhone that installs from Safari to the Home Screen and behaves like a first-party app. It's the iPhone companion to [PicKit for Windows](https://github.com/realprabhvirk/pickit): same ideas and data, rebuilt for the web.

- **Private by construction.** Photos never leave the phone. No server, no accounts, no analytics. After the first load the app makes no network requests, and a strict Content Security Policy blocks connections to anywhere else, so that's enforced by the browser, not just promised.
- **Works offline.** Everything, including the WASM image encoders, is precached by a service worker.
- **Originals are never modified.** Every export is a new file.

Target: iPhone 14 Pro (393 x 852 pt @3x), designed for iOS 26 Liquid Glass, degrading cleanly on iOS 17 and 18.

## What it does

**Edit**
- **Crop**: freeform or Original, Square, 4:5, 3:4, 16:9, 9:16; rule-of-thirds grid; corner and edge handles with 44 pt touch areas; edges snap to the photo.
- **Resize**: pixels, millimetres or centimetres at a DPI; proportions locked by default; warns before enlarging or stretching.
- **Rotate**: quarter turns, flip horizontal and vertical, and straighten up to 45° with a live preview (corners are trimmed so nothing is empty).
- **Markup**: pen (Apple Pencil pressure where present), highlighter, arrow, line, rectangle, ellipse, text (six fonts, any size and colour), eraser that cuts strokes, and select-to-move, restyle or delete. Markup stays editable vectors until export.
- **Resize For**: the Windows app's preset list (Instagram, YouTube, LinkedIn, Facebook, Discord, email, wallpapers). Shows the crop it needs over the photo, the preset's note, what will be cut, and warns before enlarging.
- **Photo switcher**: several photos open at once, each with its own edits and undo, in a tab-overview-style grid.
- **Undo and redo** for every edit. Steps store only what changed; when they use too much memory, the oldest move to on-device storage instead of being lost.

**Privacy**
- **Blur, pixelate or redact** with a box, rounded box, ellipse or brush. These change the pixels themselves. Redaction writes solid colour into the image data, so it can't be recovered from an export.
- **Location, camera and author details**: shown in Details, removed from every export by default, and **Make a Copy Without Details** cleans the original by rewriting the file's container (JPEG segments, PNG chunks, WebP chunks) without recompressing. Anything that can't be rewritten safely, such as HEIC, gets a fresh re-encode instead, and the app says so.

**Remove background**: Remove and Keep brushes with size and softness, shown over a checkerboard. The brush stays the same size on screen as you zoom. No AI model.

**Compress and convert**: JPEG (MozJPEG), PNG (optionally OxiPNG), WebP, by quality or to a **target file size**. The size shown is the real file, made in a worker as you change settings, so Share can open the iOS share sheet straight from the tap. Safari can't reliably encode WebP from a canvas, so all encoding uses WASM codecs.

**Export**: Share (Save Image, AirDrop, Messages and the rest), Copy (to paste into any app), Save to Files. Camera details can be kept when saving a JPEG as JPEG.

**Batch**: compress, resize, convert or rename many photos. You see the new names, sizes and the first photo's real output before anything is made; it runs one photo at a time with Cancel; results are shared together or saved as a ZIP; Undo discards the run and puts the settings back. Rename patterns: `{name}`, `{number}`, `{date}`, `{width}`, `{height}`. Nothing is overwritten.

**Clipboard**: paste images in (button, or a paste anywhere on the picker) and copy edited images out.

**Resume**: iOS can close a Home Screen app at any moment, so open photos (pixels, markup, names, the tool in use) are saved on the phone as you work. On the next launch the picker offers Resume. Undo history isn't saved across launches; it can be hundreds of megabytes.

**Large photos**: PicKit probes how big a canvas the device really draws. iPhones have historically capped it at about 16.7 MP and silently render bigger ones blank, so a 48 MP photo is edited as a reduced working copy, and the app says so. Details shows both resolutions and notes when a wide-gamut (Display P3) photo is shown in sRGB.

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

**Unit tests (84)**: crop and resize maths, physical sizes, straightening, markup hit-testing, transforms and the eraser, metadata reading and stripping (a JPEG with GPS EXIF, XMP and a comment; PNG and WebP built byte by byte; damaged and fuzzed input), EXIF carry-over with location dropped, target-size search, blur, pixelate and resampling, undo history, rename patterns, the ZIP writer, presets, glass legibility, springs and the view transform.

**End-to-end tests (23)**, iPhone 14 Pro viewport at @3x: the service worker installs and every precached file is verified; with the network off, a full reload still opens, edits and exports a photo; nothing is requested from any other origin through a whole session; crop then export gives a file of the cropped size; redaction is black in the exported pixels; location and camera details are shown, left out of exports, kept on request, and removable from the original without recompressing; a target size is met; several photos keep separate undo; batch compress makes a valid ZIP and Undo restores the settings; rename flags clashes; edits survive a reload through Resume; damaged files fail with a message; the back gesture closes the top layer. Light and dark screenshots go to `test-results/screenshots/`.

Two Playwright projects share that viewport: `webkit-iphone` (install WebKit once with `npx playwright install webkit`) and `chromium-iphone` (`npx playwright test --project=chromium-iphone`).

Linux browsers aren't iOS Safari. Glass rendering, the share sheet, haptics, the status bar and real canvas memory limits need the phone: see [docs/DEVICE-CHECK.md](docs/DEVICE-CHECK.md).

`npm run assets` regenerates the icons and launch images from `src/assets/app-icon/icon.svg`. `node scripts/make-fixtures.mjs` and `node scripts/make-exif-fixture.mjs` regenerate the synthetic test photos.

## Deploy (Cloudflare Pages)

1. In Cloudflare: **Workers & Pages > Create > Pages > Connect to Git**, and pick this repository.
2. Build settings:
   - Framework preset: None
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Environment variable: `NODE_VERSION` = `22` (optional; `.nvmrc` says the same)
3. Save and deploy. The build log should end with `Bundle audit passed`.

**Black screen and a blank Home Screen icon?** The build settings above are missing, so Cloudflare is serving the source instead of `dist/`. Check: `https://<your-site>/icons/apple-touch-icon.png` should be an image, not a page. Fix the settings, retry the deployment, then delete the icon on the phone and add it again (iOS keeps the icon from when it was added).

No Functions or Workers are used; it's static files only. `public/_headers` sets the CSP, `nosniff`, `no-referrer`, a locked-down `Permissions-Policy`, `no-cache` on `index.html`, `sw.js` and the manifest, and a year of immutable caching on hashed `/assets/*`.

### Add to Home Screen on iPhone

1. Open the site in Safari.
2. Tap **Share**. On iOS 26 it's in the **•••** menu next to the address bar.
3. Scroll down and tap **Add to Home Screen** (under **View More** if it isn't listed).
4. On iOS 26, leave **Open as Web App** switched on, then tap **Add**.

PicKit shows these steps itself, once, the first time it's opened in a Safari tab. Installed apps are also exempt from Safari's 7-day storage eviction, which matters for settings and unfinished edits.

Updates download in the background and wait: an **Update ready** toast applies them when you tap Update, or on the next cold launch. Never mid-edit.

## How it's put together

| Folder | Purpose |
|---|---|
| `src/design` | Tokens (system colours, type scale, geometry), the Liquid Glass recipe, springs |
| `src/ui` | Hand-built iOS components: Button, Toolbar, Sheet, Segmented, Switch, Slider, List, NavScreen, Menu, Alert, Toast, Icon |
| `src/app` | Shell: screen stack, back navigation, open photos, autosave, service worker, install help, tilt |
| `src/engine` | Decoding, canvas probe, documents and undo, the canvas view, markup, metadata, export, the worker and WASM codecs, geometry, rename, ZIP |
| `src/tools` | One component per editing tool, plus the crop frame |
| `src/screens` | Picker, Editor, Switcher, Batch, Settings, Offline, About |
| `src/store` | IndexedDB: settings, autosaved photos, spilled undo steps |
| `src/sw.ts` | The service worker |

Decisions worth knowing:

- **Preact + signals, no UI kit.** Every control is hand-built CSS. Off-the-shelf iOS kits imitate older iOS and fight the Liquid Glass look.
- **Glass is an approximation.** WebKit can't refract the page (`backdrop-filter: url()` is Chromium-only), so glass is blur, saturation and brightness, an edge light from inset shadows, a 0.5 pt gradient rim and a specular sheen that can follow device tilt. Glass is only used for chrome floating over content, never nested, and never with an animated blur. Under Increase Contrast, Reduce Transparency, or without `backdrop-filter`, it becomes opaque with the same shapes.
- **Glass stays legible over any photo.** After each gesture settles, the editor samples the photo's luminance behind each control and picks white or black glyphs plus the least scrim that reaches 4.5:1.
- **The canvas is viewport-sized.** The photo is drawn into a canvas the size of the screen, from half-size copies when zoomed out, so a huge photo never needs a second full-size canvas for display. Markup and tool previews draw on top with the same code that renders exports.
- **Heavy work runs in a worker**: encoding, target-size search, blur and pixelate, with transferable buffers. If a worker can't start, the same code runs on the main thread.
- **Undo stores only what changed** (a rectangle for a blur, the whole picture for a crop, only the list for markup), after the Windows app's design where each step holds whichever state isn't on show.
- **Springs everywhere, interruptible.** Sheets, screens and the photo animate with springs that start from the live position and velocity, so they can be grabbed mid-flight. Flicks project their resting point; edges rubber-band. Reduce Motion swaps them for short fades.
- **Single-threaded WASM.** No SharedArrayBuffer, so no COOP/COEP needed. OxiPNG is imported from its single-thread build so the threaded one is never bundled.
- **Status bar.** `black-translucent` lets the editor run under the Dynamic Island. iOS draws that status bar text white in both appearances, so light screens get a dark scrim behind it. If it looks wrong on the device, switching to `default` is one line in `vite.config.ts` (then re-add to Home Screen).

### Not done (stretch goals)

- WebGL lensing for glass over the photo. The CSS glass is used everywhere.
- Tiled full-resolution export of photos larger than the canvas budget. They export at the working size, and the app says so.
- A real landscape layout. Landscape shows a polite "Rotate to portrait" notice.
- Erase-similar-colour for background removal (optional in the brief).

### Icons and fonts

The icons are original SVG drawings made for PicKit in the visual style of SF Symbols (regular weight, round caps and joins, one sprite). SF Symbols and SF Pro are licensed for Apple platforms only, so neither is bundled. Text uses `-apple-system`, which is SF Pro on the iPhone.

## Licence

MIT. See [LICENSE](LICENSE) and [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
