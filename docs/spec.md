# vCard Generator Engine (vCGE): Architecture & Project Brief

**Creators:** raven575, Gemini & Claude

## 1. Core Goal & Privacy-First Design
The vCard Generator Engine (vCGE) is a high-security, cross-platform digital business card processing system designed around zero-trust, offline-first, and privacy-focused principles. Its primary goal is to ingest physical or digital business cards, extract contact text locally via WebAssembly OCR, and generate interactive 3D business cards with scannable vCard QR codes without leaking sensitive information to external cloud servers.

## 2. Modular Architecture
The application is structured into a strictly modular ES Architecture consisting of eight functional modules and a global shared library:
- **vCGE-SHARE:** Global shared utilities (event bus, data schemas, cryptography helpers, regex matchers, vCard formatters).
- **vCGE-MOD01:** Container shell, theme state, and security network interceptor.
- **vCGE-MOD02:** Secure storage vault utilizing AES-GCM-256 encryption at rest and native OS keychain integration.
- **vCGE-MOD03:** Active camera and acquisition viewfinder with zoom controls and a post-capture crop/warp preview modal.
- **vCGE-MOD04:** On-device WebAssembly OCR engine powered by Tesseract.js for air-gapped text extraction.
- **vCGE-MOD05:** Contact form schema mapper, regex heuristic auto-mapper, and debounced address autocomplete suite.
- **vCGE-MOD06:** Virtual business card GUI featuring an interactive 3D card flip renderer and customized typography bindings.
- **vCGE-MOD07:** Offline vCard 3.0/4.0 syntax builder and HTML5 Canvas QR code matrix generator.
- **vCGE-MOD08:** Outbound sharing controller functioning as the sole egress gateway for Web Share payloads, .vcf downloads, PNG exports, and physical card printing.

## 3. Current Progress & Verification Status
*Verified 2026-10-12. The source was imported from the Google Drive export (`vCGE FILES/vCGE-Master`, 23 files), read in full, fixed and integrated. Every JavaScript file passes a Node 22 syntax check. The suites are committed in `tests/`: `npm test` (46 unit cases) and `npm run test:e2e` (45 end-to-end cases in headless Chromium) both pass.*

**Overall:** the app runs end-to-end in a browser (`npm start`). It is integrated, offline and encrypted at rest, with on-device OCR and scannable QR codes. The Tauri desktop build does not exist yet (see 3.2).

### 3.1 What works (verified)
- **Integration:** `src/main.js` wires every module over one event bus: MOD03 camera or upload → MOD04 OCR → MOD05 mapper → MOD06 card view → MOD07 vCard and QR → MOD02 vault and MOD08 egress. `index.html` is the full app UI, loaded as ES modules (`<script type="module">`).
- **One schema, one bus, one format:** `share/cardSchema.js` (`CONTACT_FIELDS`) is the only contact schema; form element IDs, the mapper output and the vault payload all use it. `share/eventBus.js` (`globalEventBus`, `Events`) is the only event system. `share/vcardFormatter.js` is the only vCard builder: MOD07 delegates to it, and it escapes text per RFC 2426, uses CRLF per RFC 2425, and sets the PHOTO type from the image. MOD05 `ContactFormMapper` is the only OCR text mapper (name, title, organization, both phones, email, website, street, City/ST/ZIP). Every module is an ES module.
- **MOD02 vault (encrypted persistence):**
  - On first run the user creates a passphrase (8+ characters) or chooses "Continue without saving". Edits are then saved with AES-GCM-256 (PBKDF2-SHA256, 100k iterations, stored salt) after a 400 ms debounce.
  - After a reload, the right passphrase restores the card and a wrong one is rejected.
  - Lock drops the key but keeps the vault. Wipe deletes it.
  - Storage never contains plaintext contact data; this was checked in the browser.
- **vCGE-SHARE `CryptoUtils`** has no default key: it requires a passphrase, derives the key with PBKDF2, and uses a fresh salt for each encryption.
- **MOD03/MOD04 intake:** image upload (10 MB limit) and the camera viewfinder (zoom, tap-to-focus, switch, capture) open a review modal. "Extract fields" runs OCR, maps the text and merges it into the form.
- **On-device OCR:** Tesseract.js 5.1.1 runs from bundled files: the worker, the LSTM WASM core (SIMD and non-SIMD builds) and the English `best_int` model, all in `src/vendor/tesseract/`. The worker loads from a same-origin URL and caching is off, so the language data never goes to IndexedDB. On a rendered test card it correctly read all 11 fields (name, title, organization, phone, email, website, street, city, state, ZIP) in about 1.5 s, with zero external requests. If the engine can't start, MOD04 falls back to sample text and the UI says so.
- **Scannable QR:** MOD07 renders with the bundled qrcode-generator 1.4.4 (MIT): UTF-8, error-correction level M, whole-pixel modules and a 4-module quiet zone. jsQR decodes it back to the exact vCard, including accented names. Data too large for one QR code shows a labelled fallback. The QR payload leaves out the photo; the .vcf keeps it.
- **MOD05 local address suggestions** fill in street, city, state, ZIP and country, with no network lookup.
- **MOD06 card view:** live preview, 3D flip, five palettes, three typefaces (Inter, Playfair Display and Fira Code, bundled as OFL-1.1 WOFF2 in `src/vendor/fonts/`), avatar (PNG/JPEG, 2 MB limit), three sample presets, toasts, and app-wide light/dark mode. Tested at desktop width and at 390 px wide with no horizontal scroll.
- **Ephemeral memory lifecycle (120 s TTL):**
  - `TTLMemoryStreamManager` uses a wall-clock deadline, so timers throttled in background tabs cannot extend it.
  - Any pointer, key or input activity restarts it, and a countdown in the Security panel shows the time left.
  - After 120 s idle it purges RAM: it zero-fills the contact snapshot, clears the form, preview and QR, drops the captured image and review modal, and stops the camera.
  - In vault mode the purge also locks the vault (the encrypted copy stays on disk); in memory-only mode the card is cleared.
  - Each purge is logged as `RAM purged (idle)`.
  - On every start, plaintext keys left by older builds are deleted (startup residue check).
- **MOD08 egress:** .vcf download, share sheet (clipboard fallback), QR PNG export, email, SMS and print all go through `egressController`. Each action publishes `EXPORT_DISPATCHED`, and the Security panel shows an audit log of egress, blocked requests, vault and OCR events.
- **No network egress:**
  - The MOD01 gatekeeper is imported first. It wraps `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource` and `sendBeacon`, blocks every non-same-origin request and publishes `EGRESS_BLOCKED`.
  - The CSP restricts scripts, styles and connections to `'self'`.
  - Tailwind is compiled locally (`npm run build:css`).
  - A full browser session made zero non-local requests, and same-origin requests still work.

### 3.2 Remaining gaps
1. **No desktop build:** there is no Vite config and no Tauri project (`tauri.conf.json`, `src-tauri/`), so the planned Tauri v2 build cannot run. The app currently runs as a local web page.
2. **No OS keychain integration:** the vault key is derived from the passphrase only. The macOS Keychain, Windows DPAPI and Linux libsecret integration needs the Tauri side.
3. **Zero-fill is best-effort by nature:** the purge removes every reference the app holds and overwrites what it can, but JavaScript strings are immutable and garbage-collected, so the engine may keep copies in freed memory until they are reclaimed. Guaranteed wiping would need native memory (the Tauri side).

## 4. Key Technical Decisions
- **RAM TTL Streams:** To eliminate persistent data residue risks, visual renderers and QR generators consume short-lived, read-only memory streams protected by a 120-second TTL auto-purge protocol and startup memory residue checks. *(Status: wired in — 120 s idle purge plus a startup residue check; see 3.1, with the zero-fill limits in 3.2 #3.)*
- **Sole Egress Gateway:** Sub-modules are strictly blocked from making direct network calls; all external sharing routes exclusively through MOD08 to enforce total telemetry visibility. *(Status: enforced — the MOD01 gatekeeper blocks non-same-origin network calls and the CSP restricts connections to `'self'`; see 3.1.)*
- **Dual-Licensing Model:** The public repository utilizes an MIT License for open-source transparency and auditability, while preserving the legal right to distribute pre-compiled binary packages under a proprietary commercial EULA. *(Status: every bundled dependency is MIT or Apache-2.0; GPL-3.0 QRious was replaced with MIT qrcode-generator to keep the commercial option open. See `THIRD_PARTY_NOTICES.md`.)*
