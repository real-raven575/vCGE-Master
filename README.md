# vCard Generator Engine (vCGE)

> **Zero-Trust, Offline-First, Privacy-Focused Digital Business Card Ecosystem**

The **vCard Generator Engine (vCGE)** is a high-security, cross-platform digital business card processing system. Built on a modular ES Architecture and powered by Tauri v2, vCGE processes physical business cards via hardware camera feeds or local file uploads, parses text locally via WebAssembly OCR, and generates interactive 3D business cards with scannable vCard QR codes—all without leaving your device.

---

## 🔑 Core Architectural Tenets

*Design targets. Implementation status is tracked in [`docs/spec.md` §3](docs/spec.md#3-current-progress--verification-status).*

1. **The Vault Principle (`vCGE-MOD02`):** Nothing is stored. The vault is temporary and lives in memory only: leaving or reloading the page, or 7 minutes without activity, wipes the card, the photo and the scan. With a 4-digit session PIN the screen timing out only locks the card; without one, 30 seconds out of view or 2 idle minutes wipe it. A locked card is held encrypted with AES-GCM-256 under a key made for that lock alone.
2. **Ephemeral Memory Lifecycle:** The card being edited (`MOD06`) lives only in the page's form fields and in memory, never in storage, and QR code matrix generation (`MOD07`) operates on volatile RAM streams; both are protected by a 120-second TTL zero-fill auto-purge protocol and startup memory residue checks.
3. **Sole Egress Gateway (`vCGE-MOD08`):** All external data sharing (Web Share API, `.vcf` downloads, high-res PNG QR exports, SMS/Email, and 3.5" x 2" physical printing) is strictly routed through a single, audited egress controller. Direct network calls from sub-modules are intercepted and blocked by the central container.

---

## 🚧 Current Status

**Working web prototype.** The app runs end-to-end in a browser:
- Scan or upload a card, then review and edit the contact.
- Preview the 3D card.
- Keep it in the temporary in-memory vault while you work (nothing is saved).
- Share or export through MOD08.

All of this happens with no network access: the MOD01 gatekeeper and a Content-Security-Policy block every non-local request.

OCR (Tesseract.js) and QR generation (qrcode-generator) run entirely on-device from bundled files in `src/vendor/`.

**Desktop app:** Tauri v2, with the same memory-only vault. Linux builds are verified end to end; macOS and Windows builds and Rust tests pass in CI but the apps are not yet tested on those systems.

The full verified status is in [`docs/spec.md` §3](docs/spec.md#3-current-progress--verification-status).

## ▶️ Running locally

ES modules don't load from `file://`, so serve the folder over HTTP. This needs Node.js 18 or later and no other dependencies:

```bash
npm start            # serves http://localhost:8080 (localhost only; PORT=xxxx to change)
```

The app opens straight to an empty card, and nothing is ever saved. Leaving or reloading the page wipes it, and so do 7 minutes without activity. Back, by button or swipe, asks before it wipes.

Without a PIN, 30 seconds with the app out of view or 2 idle minutes wipe the card (the photo picker and share sheets the app opens get the 2-minute rule instead). Set a 4-digit **session PIN** under Security → Quick unlock and the screen timing out, another app, or 2 idle minutes only lock the card (and any scan you were reviewing): typing the 4 digits brings it straight back, and so can Face ID or a fingerprint once added there. Everything is wiped after 7 minutes without activity.

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
npm test                          # 230 unit tests (Node)
npx playwright install chromium   # once, for the browser tests
npm run test:e2e                  # 183 browser end-to-end tests (real OCR, icons, crop & straighten, text review, logo fitting and trimming, wide-logo strip, reopen last scan, scan kept across a PIN lock, undo, typed fields & regions, blurry-photo retake, OCR failure, QR decode, nothing stored, wipe on reload / 30 s out of view / idle, lock on screen off with a PIN, 7-minute reset, Back guard, session PIN, biometric unlock, SMS and email summary, one-page print, egress lock)
SERVE_DIR=dist npm run test:e2e   # same suite against the Vite build (run `npm run build` first)
npm run test:icons                # icon-detection accuracy on three icon sets the detector does not use as templates
(cd src-tauri && cargo test)      # 2 Rust tests (deleting the old keychain device key)
npm run test:tauri                # 22 desktop tests on Linux: real binary via tauri-driver, real Secret Service, nothing stored, session PIN after a real idle lock, crop by real pointer input, icon detection
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
│   └── icons/                     # generated from app-icon.png (`npx tauri icon`)
└── src/
    ├── main.js                    # Master Integration Controller (wires all modules over the event bus)
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
        ├── mod01-shell/           # netLock.js + workerGuard.js (network lock: page, OCR worker), shell.js (audit bridge), themeManager.js (light/dark)
        ├── mod02-vault/           # vault.js (temporary vault, memory only: AES-GCM-256 hold/release, old-vault clean-up), sessionPin.js (4-digit PIN), biometric.js (Face ID / fingerprint via WebAuthn, on-device), secretInputs.js (no save-password prompts), keychain.js (deletes the old desktop device key), ttlManager.js (120 s idle purge), vaultStore.js + wipePolicy.js (hub store with per-module handles and the wipe rules; built and tested, not yet wired into main.js)
        ├── mod03-camera/          # camera.js (viewfinder, zoom, capture), cropEditor.js (corner handles, rotate), perspective.js (straightening maths)
        ├── mod04-ocr/             # ocrWorker.js (image pre-processing + bundled Tesseract.js, on-device), iconDetector.js + iconMatcher.js (icons in front of lines), glyphChoices.js (second guesses for each letter)
        ├── mod05-form/            # formMapper.js (OCR text → contact), addressAutocomplete.js (local-only)
        ├── mod06-gui/             # card3dView.js (CardView: form, preview, palettes, typeface, logo trimming and layout), cardStyles.css
        ├── mod07-qr/              # qrGenerator.js (vCard via shared builder, scannable QR via qrcode-generator)
        └── mod08-egress/          # egressController.js (share, .vcf, QR PNG, mailto/sms, print + audit), print.css
```

**Rebuilding the CSS:** after changing Tailwind classes in `index.html` or `src/**/*.js`, run `npm install` and then `npm run build:css`, and commit the updated `src/styles/tailwind.css`.

---

## 👥 Creators

raven575, Gemini & Claude

## 📄 License

[MIT](LICENSE.md). Pre-compiled binary distributions may additionally be offered under a separate commercial EULA (see [`docs/spec.md` §4](docs/spec.md#4-key-technical-decisions)).
