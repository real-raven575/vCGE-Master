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
*Verified 2026-10-12 against the files imported from the Google Drive export (`vCGE FILES/vCGE-Master`, 23 files). Every file was read in full, every JavaScript file was syntax-checked with Node 22, the pure-logic modules were run in a 32-case functional test, and `index.html` was loaded in headless Chromium.*

**Overall:** the design is complete, but the code is at prototype stage. Each module exists on its own, but nothing wires them together yet. `index.html` loads only MOD01, and as shipped it does not run.

### 3.1 What works (verified)
- **vCGE-SHARE:** `EventBus` (publish, unsubscribe, error isolation), `createEmptyContact` / `validateContact`, `CryptoUtils` AES-GCM round-trip, `RegexMatchers.parseOCRText` (name, email, URL, phone, ZIP).
- **MOD02:** `SecureStorageVault` encrypts and decrypts within a single session (PBKDF2-SHA256, 100k iterations, AES-GCM-256). The `TTLMemoryStreamManager` timer expires and fires its code-3001 callback.
- **MOD05:** `ContactFormMapper.parseOCRText` and the US/UK phone formatting.
- **MOD07:** `generateVCard30` escapes `, ; \` and newlines correctly and normalises BDAY.
- **MOD01:** once the script paths are corrected (see 3.2 #1), typing updates the card preview, the 3D flip works, and `window.vCGE.Broker` loads.
- All other JavaScript files pass the syntax check. `camera.js` and `egressController.js` need real browser and hardware APIs, so they were only syntax-checked, not run.

### 3.2 Blocking defects (the app does not run as intended)
1. **Broken script paths:** `index.html` loads `themeManager.js` and `shell.js` from the repository root, but they live in `src/modules/mod01-shell/`. Both return 404, so the UI is inert.
2. **MOD06 file contents are swapped:** `card3dView.js` contains CSS (a syntax error when loaded as JS), and `cardStyles.css` contains the 25 KB JavaScript card logic.
3. **No integration layer:** `src/main.js` is empty and `src/styles/` is empty. MOD02–MOD08 are never loaded. The MOD06 logic targets element IDs (`firstName`, `qrCanvas`, `card3DFlipper`, …) that do not exist in `index.html`.
4. **No build tooling:** there is no `package.json`, no Vite config and no Tauri project (`tauri.conf.json`, `src-tauri/`), so the planned Tauri v2 + Vite build cannot run.

### 3.3 Spec violations (security & privacy)
5. **Egress outside MOD08:** `mod05-form/addressAutocomplete.js` and the MOD06 logic send typed addresses straight to `nominatim.openstreetmap.org`, and `index.html` loads Tailwind from `cdn.tailwindcss.com`. This breaks the offline-first and sole-egress rules.
6. **Plaintext at rest:** `shell.js` (`vcge_contact_state`) and the MOD06 logic (`vcge_state`, including the avatar) save contact data to `localStorage` unencrypted. This bypasses the vault.
7. **Vault cannot reopen:** `SecureStorageVault.initialize()` generates a new random salt on every call and never reads the stored one. After a restart, the same passphrase derives a different key and decryption fails (`ERR_VAULT_DECRYPT_FAIL`, reproduced in the test).
8. **Hard-coded key:** `CryptoUtils` defaults to the literal key `vCGE-Secure-Vault-Master`, zero-padded with no KDF.
9. **No OS keychain integration** exists in the codebase.
10. **Gatekeeper is cosmetic:** `enforceGatekeeper()` only compares action-name strings. It does not intercept `fetch`, sockets or other network calls.
11. **TTL zero-fill is best-effort:** it overwrites string properties of a JS object, but JavaScript strings are immutable, so earlier copies can stay in memory. The manager is also not used by any module.

### 3.4 Functional gaps
12. **OCR is simulated:** nothing loads Tesseract.js. MOD04 falls back to fixed sample text ("Alex Morgan…") and hard-codes `state: 'CA'`. The MOD06 upload handler fills in fixed values ("Jordan Lee") whatever the image contains.
13. **The QR code is not scannable:** nothing loads QRious. The MOD07 fallback draws the text "QR Matrix Rendered", and `index.html` shows a placeholder.
14. **vCard output differs between builders:** `share/vcardFormatter.js` and the MOD06 builder do not escape `, ;`, so for example `ORG:Smith, Jones` produces a malformed vCard. All builders use LF instead of the CRLF line endings that RFC 2425 requires.
15. **Duplicated, incompatible schemas:** vCard building and OCR parsing are each implemented in up to five places, with different field names (`organization`/`org`, `jobTitle`/`title`, `avatarBase64`/`photoBase64`). There are also three unconnected event systems (`EventBus`, the shell `Broker`, and `window` CustomEvents), and the module formats are mixed (ESM, IIFE, CommonJS).

## 4. Key Technical Decisions
- **RAM TTL Streams:** To eliminate persistent data residue risks, visual renderers and QR generators consume short-lived, read-only memory streams protected by a 120-second TTL auto-purge protocol and startup memory residue checks. *(Status: timer implemented, not yet wired in — see 3.3 #11.)*
- **Sole Egress Gateway:** Sub-modules are strictly blocked from making direct network calls; all external sharing routes exclusively through MOD08 to enforce total telemetry visibility. *(Status: not enforced — see 3.3 #5, #10.)*
- **Dual-Licensing Model:** The public repository utilizes an MIT License for open-source transparency and auditability, while preserving the legal right to distribute pre-compiled binary packages under a proprietary commercial EULA.
