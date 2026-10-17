<img src="src/assets/brand/vcge-logo-192.png" alt="vCGE logo" width="96" height="96" align="right">

# vCard Generator Engine (vCGE)

> **Operation: Never Lose Contact**
>
> Zero-trust, offline-first, privacy-focused digital business cards. Created by raven575.

The **vCard Generator Engine (vCGE)** is a high-security, cross-platform digital business card processing system. Built on a modular ES Architecture and powered by Tauri v2, vCGE processes physical business cards via hardware camera feeds or local file uploads, parses text locally via WebAssembly OCR, and generates interactive 3D business cards with scannable vCard QR codes—all without leaving your device.

No ads, no tracking, no accounts, no internet: the app talks to nothing but its own bundled files, and the only thing it ever keeps is one small settings line (hand, colour-blind mode, theme, font). Everything scanned, typed or shown lives in memory and is wiped when you leave. Site: [vCGE.APP](https://vcge.app).

---

## 🔑 Core Architectural Tenets

*Design targets. Implementation status is tracked in [`docs/spec.md` §3](docs/spec.md#3-current-progress--verification-status).*

1. **The Vault Principle (`vCGE-MOD02`):** Nothing is stored. The vault is temporary and lives in memory only: leaving or reloading the page, or 7 minutes without activity, wipes the card, the photo and the scan. With a 4-digit session PIN the screen timing out only locks the card, and 7 minutes after the lock it is wiped; without one, 30 seconds out of view or 2 idle minutes wipe it. A locked card is held encrypted with AES-GCM-256 under a key made for that lock alone. The red trash button on every card wipes everything: Yes must be held for 1.5 seconds.
2. **Ephemeral Memory Lifecycle:** The card being edited (`MOD06`) lives only in the page's form fields and in memory, never in storage, and QR code matrix generation (`MOD07`) operates on volatile RAM streams; both are protected by a 120-second TTL zero-fill auto-purge protocol and startup memory residue checks.
3. **Sole Egress Gateway (`vCGE-MOD08`):** All external data sharing (Web Share API, `.vcf` downloads, high-res PNG QR exports, SMS/Email, and printing: one 6 × 3.5 in page with the card at business-card size and its QR beside it) is strictly routed through a single, audited egress controller. Direct network calls from sub-modules are intercepted and blocked by the central container.

---

## 🚧 Current Status

**Working web app, redesigned 2026-10-17 (all ten steps of the plan built).** The app is a deck of postcards, one card per step, that a swipe, the arrow keys or a header icon moves through:
- **Welcome:** the vCGE logo and tagline, Set Up PIN/BIO Lock Now, START, Take a Tour (six stops, one card at a time) and CANCEL, which leads to a Thank You page. Shown every time the app opens; nothing records that it was seen.
- **Capture (MOD03):** take or upload a photo in a clean viewfinder with a zoom fader and a round shutter, then crop and straighten it (handles, Rotate 90°, Snap to card).
- **Read (MOD04):** the photo is read on the device by Tesseract.js while a soft shimmer sweeps across it; 55 s at most, no number shown, Cancel at any time. Then each line is checked before it fills anything.
- **Fields (MOD05):** the whole form on one card, a list of sample contacts, and Everything's correct to move on.
- **3D Card (MOD06, with the QR on its back, MOD07):** eight fall themes, three typefaces, the logo traced on the device, flip and spin.
- **Share (MOD08):** .vcf, share sheet, Export QR pop-up (Themed or Black & White, square or round dots, a frame, an optional centre logo, saved exactly as previewed), email, SMS and Print / Save as PDF (Themed or Black & White, one 6 × 3.5 in page).
- **Vault page (MOD02) and Settings sheet (MOD01)** open over the deck from the header: session PIN and biometric unlock; hand, colour-blind mode, light or dark theme and one of seven fonts (Inter, Atkinson Hyperlegible, Lexend, OpenDyslexic, Tinos, Comic Neue, Macondo).

All of this happens with no network access: the MOD01 network lock and a Content-Security-Policy block every non-local request. OCR (Tesseract.js) and QR generation (qrcode-generator) run entirely on-device from bundled files in `src/vendor/`.

**Desktop app:** Tauri v2, with the same memory-only vault. Linux builds are verified end to end; macOS and Windows builds and Rust tests pass in CI but the apps are not yet tested on those systems.

The full verified status is in [`docs/spec.md` §3](docs/spec.md#3-current-progress--verification-status).

## ▶️ Running locally

ES modules don't load from `file://`, so serve the folder over HTTP. This needs Node.js 18 or later and no other dependencies:

```bash
npm start            # serves http://localhost:8080 (localhost only; PORT=xxxx to change)
```

The app opens straight to an empty card, and nothing is ever saved. Leaving or reloading the page wipes it, and so do 7 minutes without activity. Back, by button or swipe, asks before it wipes.

Without a PIN, 30 seconds with the app out of view or 2 idle minutes wipe the card (the photo picker and share sheets the app opens get the 2-minute rule instead). Set a 4-digit **session PIN** on the Vault page (the header padlock, or "Set Up PIN/BIO Lock Now" on the Welcome card) and the screen timing out, another app, or 2 idle minutes only lock the card (and any scan you were reviewing): typing the 4 digits brings it straight back, and so can a fingerprint or face once turned on there (it is only "on" after a check that passes). The lock screen leads with the fingerprint button; there is no Unlock button. Everything is wiped 7 minutes after a lock, or after 7 minutes without activity. Each move between cards plays a small padlock (orange unlocked, green locked, about 1.4 s, still under reduce motion) that says nothing and cannot be tapped. Any red trash button asks "Are you sure you want to wipe everything and start over?": Yes is held for 1.5 seconds, No is one tap, Esc or a sideways swipe; an unticked box, "Also delete my saved settings", asks once more before it counts.

### Desktop app (Tauri v2)

Prerequisites: [Rust](https://rustup.rs) and the [Tauri system dependencies](https://tauri.app/start/prerequisites/) for your OS. On Debian/Ubuntu that means `libwebkit2gtk-4.1-dev build-essential libssl-dev libxdo-dev libayatana-appindicator3-dev librsvg2-dev`.

```bash
npm install
npm run tauri dev                 # desktop window with live reload (Vite dev server on :1420)
npm run tauri build               # release build + installers in src-tauri/target/release/bundle/
```

### Tests

```bash
npm install
npm test                          # 388 unit tests (Node)
npx playwright install chromium   # once, for the browser tests
npm run test:e2e                  # 408 browser end-to-end tests (deck move through slow frames, Share card and Ready to share, file names from the contact, Export QR pop-up (styles, logo, the logo to the card through the Vault), 6 x 3.5 in Themed or Black & White print, postcard deck, Fields card (fake-contact list, pop-in, Everything's correct), Welcome card, tour, Settings sheet and the one saved entry, padlock hand-off, hold-to-wipe, real OCR, icons, lines to check, reading progress, Cancel and timeout, Capture card (viewfinder, zoom fader, shutter, the shot is the viewfinder's window, full-edge handles, Snap to card, bad uploads, left hand), crop & straighten, text review, scan replacing a sample, logo fitting and trimming, wide-logo strip, reopen last scan, scan kept across a PIN lock, undo, typed fields & regions, blurry-photo retake, OCR failure, QR decode, nothing stored, wipe on reload / 30 s out of view / idle, lock on screen off with a PIN, countdown strip and lock ring, 7 minutes from the lock, Back guard, session PIN, fingerprint-first lock screen, biometric unlock, SMS and email summary, one-page print, egress lock, MOD-XX tags, 44 px buttons and the near-miss tap guard, phone layout)
SERVE_DIR=dist npm run test:e2e   # same suite against the Vite build (run `npm run build` first)
npm run test:icons                # icon-detection accuracy on three icon sets the detector does not use as templates
(cd src-tauri && cargo test)      # 2 Rust tests (deleting the old keychain device key)
npm run test:tauri                # 27 desktop tests on Linux: real binary via tauri-driver, real Secret Service, nothing stored, session PIN after a real idle lock, crop by real pointer input, icon detection
```

`npm run test:tauri` needs `webkit2gtk-driver gnome-keyring libsecret-tools xvfb dbus-x11`, `cargo install tauri-driver --locked`, and a built app (`npx tauri build --debug --no-bundle`).

### Continuous integration

`.github/workflows/ci.yml` runs on pushes to `main` and `claude/**`, on pull requests, and on demand:
- **web**: checks that the committed generated files are current, then runs the unit tests and the browser end-to-end tests against the source and the Vite build.
- **desktop**: runs on Linux, macOS and Windows. Each builds the release app with installers and uploads them as artifacts for 14 days (`.deb`, `.rpm` and AppImage on Linux; `.app` and `.dmg` on macOS; `.msi` and setup `.exe` on Windows). Linux also runs the desktop end-to-end suite against the release binary.

Actions are pinned to commit SHAs. The installers are **unsigned**: code signing and notarisation need certificates stored as repository secrets.

---

## 📦 Repository Structure

```text
vCGE-Master/
├── LICENSE.md                     # MIT License
├── README.md
├── package.json                   # npm start, dev, build, tauri, test, test:e2e, test:icons, test:tauri, build:css, vendor (all deps pinned)
├── vite.config.mjs                # Vite build → dist/ (Tauri frontend)
├── tailwind.config.js
├── index.html                     # App UI (loads src/main.js as an ES module; CSP egress lock)
├── .github/workflows/ci.yml       # CI: web tests + desktop builds/tests on Linux, macOS, Windows
├── THIRD_PARTY_NOTICES.md         # Bundled libraries & licences (all MIT / Apache-2.0)
├── docs/
│   └── spec.md                    # Architecture brief & verification status
├── archive/v0-gemini-import/      # Original imported files (*.v0.*), kept verbatim for history; not built or run
├── scripts/
│   ├── serve.mjs                  # Dependency-free localhost static server (npm start)
│   └── vendor.mjs                 # Copies pinned libraries into src/vendor (npm run vendor)
├── tests/
│   ├── unit.test.mjs              # npm test
│   ├── e2e.test.cjs               # npm run test:e2e
│   ├── icons.e2e.test.cjs         # npm run test:icons (icon-detection accuracy, held-out icon sets)
│   ├── tauri.e2e.test.cjs         # npm run test:tauri (WebDriver against the desktop binary)
│   └── run-tauri-e2e.sh           # Xvfb + D-Bus + throwaway keyring wrapper
├── src-tauri/                     # Tauri v2 desktop shell (Rust)
│   ├── tauri.conf.json            # window, CSP, bundle targets
│   ├── capabilities/default.json  # main window may call only delete_device_secret
│   ├── src/lib.rs                 # delete_device_secret: removes the old vault device key (OS keychain via keyring crate)
│   └── icons/                     # generated from app-icon.png, the vCGE logo (`npx tauri icon`)
└── src/
    ├── main.js                    # Master Integration Controller (wires all modules over the event bus)
    ├── assets/brand/              # vCGE logo (480, 192 and 32 px PNG): tab icon, header, Welcome card
    ├── styles/                    # tailwind.input.css → tailwind.css (compiled, committed)
    ├── vendor/                    # qrcode-generator, Tesseract.js + WASM core + English model, card fonts (committed)
    ├── share/                     # Global Shared Libraries (vCGE-SHARE)
    │   ├── index.js               # Export barrel
    │   ├── cardSchema.js          # Canonical contact schema (CONTACT_FIELDS + typed lists), old-card conversion, validation
    │   ├── contactOptions.js      # Form choices: prefixes, suffixes, unit/phone/email/website types, countries, regions
    │   ├── cryptoUtils.js         # AES-GCM WebCrypto helpers
    │   ├── eventBus.js            # The single event bus + event names
    │   ├── regexMatchers.js       # Shared regex constants
    │   └── vcardFormatter.js      # The single vCard 3.0 builder (RFC 2426 escaping, CRLF)
    └── modules/                   # Isolated Core Functional Modules
        ├── mod01-shell/           # netLock.js + workerGuard.js (network lock: page, OCR worker), browserGate.js + browserGate.css + unsupported/ (old-browser gate), shell.js (audit bridge, boots the deck), deck.js + deck.css (postcard deck, header, sheets), welcome.js + welcome.css (Welcome card, tour, Thank You page), ui.js + ui.css (breakpoints, buttons, fonts), settings.js (the one saved entry: hand, colour-blind mode, theme, font)
        ├── mod02-vault/           # vault.js (temporary vault, memory only: AES-GCM-256 hold/release, old-vault clean-up), sessionPin.js (4-digit PIN), biometric.js (Face ID / fingerprint via WebAuthn, on-device), lockHandoff.js (the padlock that plays at each hand-off between cards), wipeDialog.js (hold-to-wipe), vault.css, secretInputs.js (no save-password prompts), keychain.js (deletes the old desktop device key), ttlManager.js (120 s idle purge), vaultStore.js + wipePolicy.js (hub store with per-module handles, a logo slot Export writes and the card reads, and the wipe rules; built and tested, not yet wired into main.js)
        ├── mod03-camera/          # camera.js + camera.css (Capture card: viewfinder, zoom fader, shutter, upload), viewfinder.js (visible-window and card-frame maths, stepped tween), cropEditor.js (corner handles, rotate, Snap to card), cardFinder.js (on-device card-edge finder), perspective.js (straightening maths)
        ├── mod04-ocr/             # ocrWorker.js (image pre-processing + bundled Tesseract.js, on-device), readCard.js + read.css (the Read card: shimmer, Cancel, lines to check), iconDetector.js + iconMatcher.js (icons in front of lines), glyphChoices.js (second guesses for each letter)
        ├── mod05-form/            # formMapper.js (OCR text → contact), fieldsCard.js + fields.css (the Fields card: pop-in, sample list, Everything's correct), addressAutocomplete.js (local-only)
        ├── mod06-gui/             # card3dView.js (CardView: form, preview, palettes, typeface, logo trimming and layout), cardStyles.css
        ├── mod07-qr/              # qrGenerator.js (vCard via shared builder, scannable QR via qrcode-generator)
        └── mod08-egress/          # egressController.js (share, .vcf, QR PNG, mailto/sms, print + audit), exportDialogs.js + export.css (Export QR pop-up, Print / PDF choice), print.css (one 6 × 3.5 in page)
```

**Rebuilding the CSS:** after changing Tailwind classes in `index.html` or `src/**/*.js`, run `npm install` and then `npm run build:css`, and commit the updated `src/styles/tailwind.css`.

---

## 👥 Creators

Created by [raven575](https://raven575.com), with Gemini & Claude. Home: [vCGE.APP](https://vcge.app).

## 📄 License

[MIT](LICENSE.md). Pre-compiled binary distributions may additionally be offered under a separate commercial EULA (see [`docs/spec.md` §4](docs/spec.md#4-key-technical-decisions)).
