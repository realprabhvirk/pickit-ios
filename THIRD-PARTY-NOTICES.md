# Third-party notices

PicKit for iOS ships the following software inside the app. Everything is bundled and served from PicKit's own origin; nothing is loaded from a CDN.

| Component | Used for | Licence |
|---|---|---|
| [Preact](https://github.com/preactjs/preact) | Interface | MIT |
| [Preact Signals](https://github.com/preactjs/signals) | App state | MIT |
| [Workbox](https://github.com/GoogleChrome/workbox) (`workbox-precaching`, `workbox-routing`, `workbox-core`, `workbox-window`) | Offline caching in the service worker | MIT |
| [jSquash](https://github.com/jamsinclair/jSquash) (`@jsquash/jpeg`, `@jsquash/png`, `@jsquash/oxipng`, `@jsquash/webp`) | WASM packaging of the encoders below, repackaged from Squoosh | Apache 2.0 |
| [MozJPEG](https://github.com/mozilla/mozjpeg) / libjpeg-turbo | JPEG encoding (WASM) | IJG licence and BSD 3-Clause (see `@jsquash/jpeg/codec/LICENSE.codec.md`) |
| [libwebp](https://chromium.googlesource.com/webm/libwebp) | WebP encoding (WASM, SIMD and non-SIMD builds) | BSD 3-Clause |
| Squoosh PNG codec | PNG encoding (WASM) | BSD 3-Clause, as shipped in `@jsquash/png/codec/LICENSE.codec.md` |
| [OxiPNG](https://github.com/shssoichiro/oxipng) | PNG optimisation (WASM, single-threaded build) | MIT |
| [wasm-feature-detect](https://github.com/GoogleChromeLabs/wasm-feature-detect) | Choosing the SIMD WebP encoder when available | Apache 2.0 |

Build and test tools, not distributed: Vite, vite-plugin-pwa (MIT), @preact/preset-vite (MIT), TypeScript (Apache 2.0), Vitest (MIT), Playwright (Apache 2.0).

## Data

`src/engine/presets.json` is copied unchanged from [PicKit for Windows](https://github.com/realprabhvirk/pickit) (MIT). Each preset lists the page its size came from; those links are shown as text and never fetched.

## Icons and fonts

The app icon and interface icons are original drawings made for PicKit, in the visual style of SF Symbols. They are not SF Symbols, which Apple licenses for use on Apple platforms only. No fonts are bundled: text uses the device's system font (SF Pro on iPhone) through `-apple-system`.
