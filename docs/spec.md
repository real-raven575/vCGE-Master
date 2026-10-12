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
*Verified 2026-10-12 against the files imported from the Google Drive export (`vCGE FILES/vCGE-Master`, 23 files). Every file was read in full, every JavaScript file was syntax-checked with Node 22, the pure-logic modules were run in functional tests, and `index.html` was loaded in headless Chromium. All fixes made since were re-verified the same day.*

**Overall:** the design is complete, but the code is at prototype stage. Each module exists on its own, but nothing wires them together yet. `index.html` loads only MOD01, which now runs.

### 3.1 What works (verified)
- **vCGE-SHARE:** `EventBus` (publish, unsubscribe, error isolation), `createEmptyContact` / `validateContact`, `RegexMatchers.parseOCRText` (name, email, URL, phone, ZIP). `CryptoUtils` has no default key: it requires a caller-supplied passphrase, derives the key with PBKDF2-SHA256 (100k iterations) and a fresh random salt per encryption (stored with the ciphertext), and rejects a wrong or missing passphrase.
- **MOD02:** `SecureStorageVault` encrypts and decrypts (PBKDF2-SHA256, 100k iterations, AES-GCM-256). The vault reopens after a restart with the same passphrase, and a wrong passphrase is rejected; it reuses the stored salt. The `TTLMemoryStreamManager` timer expires and fires its code-3001 callback.
- **MOD05:** `ContactFormMapper.parseOCRText` and the US/UK phone formatting.
- **vCard output:** all three builders (`share/vcardFormatter.js`, the MOD06 builder, MOD07 `generateVCard30`) escape text values per RFC 2426 (`\ , ;` and newlines) and use CRLF line endings per RFC 2425. MOD07 also normalises BDAY.
- **MOD01:** `index.html` loads its scripts from `src/modules/mod01-shell/`. Typing updates the card preview, the 3D flip works, and `window.vCGE.Broker` loads (headless Chromium).
- **MOD06:** `card3dView.js` holds the card logic and `cardStyles.css` holds the styles (their contents were swapped in the export). Both pass their checks.
- **No runtime network calls:** Tailwind is compiled locally (`npm run build:css` → `src/styles/tailwind.css`) instead of loaded from a CDN, and address autocomplete is local-only in both MOD05 and MOD06. Headless Chromium shows zero non-local requests, and no `fetch`/XHR/WebSocket calls remain in `src/` (outside the gatekeeper itself).
- **Egress is enforced:** the MOD01 gatekeeper (`shell.js`) wraps `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource` and `navigator.sendBeacon`. It blocks any non-same-origin request and publishes `EGRESS_BLOCKED` on the broker; same-origin requests (local assets) still work. A Content-Security-Policy in `index.html` (`connect-src 'self'`, `script-src 'self'`, …) enforces the same rule at browser level. Verified in headless Chromium, and normal page load raises no CSP violations.
- **No plaintext contact data at rest:** the shell and the MOD06 logic keep contact fields and the avatar in memory only, and delete the plaintext keys left by earlier builds on startup. Only non-sensitive UI preferences (theme, palette) persist. Encrypted persistence through the MOD02 vault is not wired in yet (it needs a passphrase UI), so contact data is not kept across reloads.
- All other JavaScript files pass the syntax check. `camera.js` and `egressController.js` need real browser and hardware APIs, so they were only syntax-checked, not run.

### 3.2 Blocking defects (the full app does not run yet)
1. **No integration layer:** `src/main.js` is empty. MOD02–MOD08 are never loaded. The MOD06 logic targets element IDs (`firstName`, `qrCanvas`, `card3DFlipper`, …) that do not exist in `index.html`.
2. **No app build tooling:** `package.json` only builds the CSS. There is no Vite config and no Tauri project (`tauri.conf.json`, `src-tauri/`), so the planned Tauri v2 + Vite build cannot run.

### 3.3 Spec violations (security & privacy)
3. **No OS keychain integration** exists in the codebase.
4. **TTL zero-fill is best-effort:** it overwrites string properties of a JS object, but JavaScript strings are immutable, so earlier copies can stay in memory. The manager is also not used by any module.

### 3.4 Functional gaps
5. **OCR is simulated:** nothing loads Tesseract.js. MOD04 falls back to fixed sample text ("Alex Morgan…"). The MOD06 upload handler fills in fixed values ("Jordan Lee") whatever the image contains.
6. **The QR code is not scannable:** nothing loads QRious. The MOD07 fallback draws the text "QR Matrix Rendered", and `index.html` shows a placeholder.
7. **Duplicated, incompatible schemas:** vCard building and OCR parsing are each implemented in up to five places, with different field names (`organization`/`org`, `jobTitle`/`title`, `avatarBase64`/`photoBase64`). There are also three unconnected event systems (`EventBus`, the shell `Broker`, and `window` CustomEvents), and the module formats are mixed (ESM, IIFE, CommonJS).

## 4. Key Technical Decisions
- **RAM TTL Streams:** To eliminate persistent data residue risks, visual renderers and QR generators consume short-lived, read-only memory streams protected by a 120-second TTL auto-purge protocol and startup memory residue checks. *(Status: timer implemented, not yet wired in — see 3.3 #4.)*
- **Sole Egress Gateway:** Sub-modules are strictly blocked from making direct network calls; all external sharing routes exclusively through MOD08 to enforce total telemetry visibility. *(Status: enforced — the MOD01 gatekeeper blocks non-same-origin network calls and the CSP restricts connections to `'self'`; see 3.1.)*
- **Dual-Licensing Model:** The public repository utilizes an MIT License for open-source transparency and auditability, while preserving the legal right to distribute pre-compiled binary packages under a proprietary commercial EULA.
