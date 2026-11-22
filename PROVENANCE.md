# Provenance: where vCGE comes from

This file records who made vCGE, what it is built from, and the public methods each feature rests on. Team vCGE wrote it on 2026-11-22, after a patent and licence check (research only, not legal advice). It is a record to show a lawyer or a store, and it changes nothing in the app.

## Who made it

- **Authors:** raven575, with the Herd of Helpers (Claude) and Gemini. The copyright line is "© 2026 raven575, Herd of Helpers (claude) & gemini". The code is MIT-licensed ([LICENSE.md](LICENSE.md)).
- **First version:** 23 source files that raven575 and Gemini wrote, imported on 2026-10-12 from the Google Drive export. They are kept unchanged, byte for byte, in [`archive/v0-gemini-import/`](archive/README.md).
- **History:** every later change is a commit in this repository. Its history starts on 2026-10-22, and `git log` dates each change. Changes land through pull requests with tests and CI.

## What is bundled, and from where

Every outside part is copied from a pinned npm package by `npm run vendor` (`scripts/vendor.mjs`) into `src/vendor/`, with its licence file beside it. [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) has the full table. Settings > Open-source licences shows the same list inside the app.

| Folder | What | Licence |
|---|---|---|
| `src/vendor/tesseract/` | Tesseract.js 5.1.1, tesseract.js-core 5.1.1 (the OCR engine as WebAssembly) and the English model | Apache-2.0 |
| `src/vendor/jsqr/` | jsQR 1.4.0 (reads a QR code printed on a photographed card) | Apache-2.0 |
| `src/vendor/qrcode-generator/` | qrcode-generator 1.4.4 (draws the contact's QR code) | MIT |
| `src/vendor/zip-towns/` | US ZIP-code-to-town table, built from zipcodes 8.0.0 by `scripts/zip-towns.mjs` | BSD |
| `src/vendor/icons/` | Tabler (MIT), Lucide (ISC), Simple Icons (CC0; brand logos are their owners' trademarks, used only to recognise them) and Noto Emoji animals (Apache-2.0) | as listed |
| `src/vendor/fonts/` | 10 font families from Fontsource | SIL OFL 1.1 |

Left out on purpose: QRious, because it is GPL-3.0. The app uses no other code libraries, no network services and no analytics.

## Machine learning

vCGE uses one trained model: Tesseract's English LSTM model (`eng.traineddata`, tessdata "best" `4.0.0_best_int`, Apache-2.0, Google / Tesseract OCR contributors), shipped as `src/vendor/tesseract/lang/eng.traineddata.gz`. It runs only on the device.

Checksums (sha256) of the bundled engine and model as of 2026-11-22:

```
45b4cb346724ac1774f1c36f42f182b887bcdb28ebe63e6fff90ac41f3fcff91  src/vendor/tesseract/lang/eng.traineddata.gz
8f04aa0cc81e7bde33f80e92fa01a7a665f0b4884d098acf5de9c7104a11dfaa  src/vendor/tesseract/core/tesseract-core-lstm.wasm.js
ce20eda9533cbed1e6c2b4276fbae1e0adc61b6754b5513084be601787b457cf  src/vendor/tesseract/core/tesseract-core-simd-lstm.wasm.js
```

The icon finder, logo finder, reading-quality check and field mapper are hand-written rules and measurements. None of them is a trained model.

## Features and the public methods behind them

| Feature (module) | How it works | Public basis |
|---|---|---|
| Reading the card (MOD04) | Tesseract OCR on the device, with greyscale, contrast stretch and enlarging first | Tesseract (open source since 2005); standard image clean-up |
| Blur check (MOD04) | No-reference blur score: how much one more blur changes the photo | Crete et al., "The blur effect", SPIE 2007 |
| Icons beside lines (MOD04) | Histograms of edge direction compared with bundled icon outlines | HOG: Dalal and Triggs, CVPR 2005 |
| Second guesses (MOD04) | The engine's own runner-up letters for unsure spots | Tesseract's `lstm_choice_mode` option |
| Sorting lines into fields (MOD05) | Pattern rules (regular expressions) for phones, emails, web, addresses and names | Common text patterns; vCard field names from RFC 6350 |
| Town fix (MOD05) | When the read town is one or two letters off the ZIP code's own town in the bundled table, use the table's town | Edit distance (Levenshtein 1965); USPS ZIP codes |
| Contact file (MOD08) | Writes a vCard 3.0 file | IETF RFC 2426 (vCard 3.0) and RFC 6350 (open standards) |
| QR code (MOD07) | Draws the vCard as a QR code | ISO/IEC 18004; DENSO made the QR patent free to use. "QR Code" is DENSO WAVE's trademark |

## What vCGE does not do

These notes help when comparing vCGE with patents on card scanning:
- It never sends a photo or text to a server. Everything happens on the device, and the network is blocked.
- It doesn't connect to Outlook or any address book. It hands a .vcf file to the phone's own contacts app, which asks before saving.
- It has no lead forms, texting between people, accounts or online contact database.
- It keeps nothing. Contacts live in memory and are wiped after a few minutes; the only stored item is one settings line.

## Open items (from the 2026-11-22 check)

- Before the public store launch, a patent lawyer looks at Xerox US 7,826,665 (OCR card candidates scored by a database lookup; compare the town fix), Apple US 8,311,806 and US 8,738,360 (data detectors), and the ScanComm QR suits.
- Check the USPTO record for the "NEVER. LOSE. CONTACT." filing (serial 88589890) against the tagline.
