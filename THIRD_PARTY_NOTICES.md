# Third-Party Notices

vCGE bundles the following third-party software in `src/vendor/`. The files are copied from pinned npm packages by `npm run vendor` (`scripts/vendor.mjs`) and committed, so the app runs offline with no CDN. All of these licences allow use in MIT-licensed source and in proprietary binary distributions, provided their notices are kept.

| Component | Version | Licence | Bundled files | Copyright |
|---|---|---|---|---|
| [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) | 1.4.4 | MIT (notice in file header) | `src/vendor/qrcode-generator/qrcode.js` | © 2009 Kazuhiko Arase |
| [Tesseract.js](https://github.com/naptha/tesseract.js) | 5.1.1 | Apache-2.0 (`src/vendor/tesseract/LICENSE.md`) | `src/vendor/tesseract/tesseract.min.js`, `worker.min.js` | Tesseract.js contributors |
| [tesseract.js-core](https://github.com/naptha/tesseract.js-core) | 5.1.1 | Apache-2.0 (`src/vendor/tesseract/core/LICENSE`) | `src/vendor/tesseract/core/tesseract-core-*-lstm.wasm.js` (Tesseract OCR engine compiled to WebAssembly) | Tesseract OCR / Google, tesseract.js-core contributors |
| [@tesseract.js-data/eng](https://www.npmjs.com/package/@tesseract.js-data/eng) | 1.0.0 (`4.0.0_best_int` model) | MIT (package); the model comes from [tesseract-ocr/tessdata](https://github.com/tesseract-ocr/tessdata), Apache-2.0 | `src/vendor/tesseract/lang/eng.traineddata.gz` | Google / Tesseract OCR contributors |

"QR Code" is a registered trademark of DENSO WAVE INCORPORATED.

Development-only dependencies (not bundled into the app) are listed in `package.json`: Tailwind CSS (MIT), Playwright (Apache-2.0) and jsQR (Apache-2.0).

QRious, which the original code targeted, was deliberately **not** bundled: it is GPL-3.0, which is incompatible with distributing proprietary binaries under the planned commercial EULA (see `docs/spec.md` §4).
