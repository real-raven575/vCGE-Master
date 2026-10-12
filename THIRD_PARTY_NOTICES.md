# Third-Party Notices

vCGE bundles the following third-party software in `src/vendor/`. The files are copied from pinned npm packages by `npm run vendor` (`scripts/vendor.mjs`) and committed, so the app runs offline with no CDN. All of these licences allow use in MIT-licensed source and in proprietary binary distributions, provided their notices are kept. (The OFL fonts may be bundled and sold with software; they just can't be sold on their own.)

| Component | Version | Licence | Bundled files | Copyright |
|---|---|---|---|---|
| [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) | 1.4.4 | MIT (notice in file header) | `src/vendor/qrcode-generator/qrcode.js` | © 2009 Kazuhiko Arase |
| [Tesseract.js](https://github.com/naptha/tesseract.js) | 5.1.1 | Apache-2.0 (`src/vendor/tesseract/LICENSE.md`) | `src/vendor/tesseract/tesseract.min.js`, `worker.min.js` | Tesseract.js contributors |
| [tesseract.js-core](https://github.com/naptha/tesseract.js-core) | 5.1.1 | Apache-2.0 (`src/vendor/tesseract/core/LICENSE`) | `src/vendor/tesseract/core/tesseract-core-*-lstm.wasm.js` (Tesseract OCR engine compiled to WebAssembly) | Tesseract OCR / Google, tesseract.js-core contributors |
| [Inter](https://github.com/rsms/inter) via [@fontsource/inter](https://fontsource.org/fonts/inter) | 5.3.0 | SIL OFL 1.1 (`src/vendor/fonts/LICENSE-inter.txt`) | `src/vendor/fonts/inter-latin-{400,600,700}.woff2` | © 2016 The Inter Project Authors |
| [Playfair Display](https://github.com/clauseggers/Playfair-Display) via [@fontsource/playfair-display](https://fontsource.org/fonts/playfair-display) | 5.3.0 | SIL OFL 1.1 (`src/vendor/fonts/LICENSE-playfair-display.txt`) | `src/vendor/fonts/playfair-display-latin-{400,600,700}.woff2` | © 2017 The Playfair Display Project Authors (Reserved Font Name "Playfair Display") |
| [Fira Code](https://github.com/tonsky/FiraCode) via [@fontsource/fira-code](https://fontsource.org/fonts/fira-code) | 5.3.0 | SIL OFL 1.1 (`src/vendor/fonts/LICENSE-fira-code.txt`) | `src/vendor/fonts/fira-code-latin-{400,600,700}.woff2` | © 2014-2020 The Fira Code Project Authors |
| [@tesseract.js-data/eng](https://www.npmjs.com/package/@tesseract.js-data/eng) | 1.0.0 (`4.0.0_best_int` model) | MIT (package); the model comes from [tesseract-ocr/tessdata](https://github.com/tesseract-ocr/tessdata), Apache-2.0 | `src/vendor/tesseract/lang/eng.traineddata.gz` | Google / Tesseract OCR contributors |

"QR Code" is a registered trademark of DENSO WAVE INCORPORATED.

The desktop binary (`src-tauri/`) also compiles in Rust crates, notably [Tauri](https://tauri.app) 2.12.0 (MIT or Apache-2.0) and [keyring](https://github.com/hwchen/keyring-rs) 3.6.3 (MIT or Apache-2.0), plus their dependencies, all pinned in `src-tauri/Cargo.lock`. As of this lockfile, all 498 crates are under permissive licences (MIT, Apache-2.0, BSD, ISC, Zlib, Unicode-3.0, 0BSD, Unlicense/CC0 options), with none GPL-only. The exception is five crates under MPL-2.0 (`cssparser`, `cssparser-macros`, `selectors`, `dtoa-short`, `option-ext`), pulled in by Tauri's build-time HTML tooling. MPL-2.0 is file-level copyleft: it permits proprietary binaries, and only modified MPL files must be shared. To produce the full per-crate notice file for a binary release, run e.g. `cargo about` in `src-tauri/`.

Development-only dependencies (not bundled into the app) are listed in `package.json`: Tailwind CSS (MIT), Vite (MIT), the Tauri CLI (MIT or Apache-2.0), Playwright (Apache-2.0) and jsQR (Apache-2.0).

QRious, which the original code targeted, was deliberately **not** bundled: it is GPL-3.0, which is incompatible with distributing proprietary binaries under the planned commercial EULA (see `docs/spec.md` §4).
