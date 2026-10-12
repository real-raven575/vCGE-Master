# vCard Generator Engine (vCGE)

> **Zero-Trust, Offline-First, Privacy-Focused Digital Business Card Ecosystem**

The **vCard Generator Engine (vCGE)** is a high-security, cross-platform digital business card processing system. Built on a modular ES Architecture and powered by Tauri v2, vCGE processes physical business cards via hardware camera feeds or local file uploads, parses text locally via WebAssembly OCR, and generates interactive 3D business cards with scannable vCard QR codes—all without leaving your device.

---

## 🔑 Core Architectural Tenets

*Design targets. Implementation status is tracked in [`docs/spec.md` §3](docs/spec.md#3-current-progress--verification-status).*

1. **The Vault Principle (`vCGE-MOD02`):** All personal contact data, OCR text arrays, and card assets are encrypted at rest using AES-GCM-256 (PBKDF2-HMAC-SHA256) with native OS Keychain integration (macOS Keychain, Windows DPAPI, Linux Libsecret).
2. **Ephemeral Memory Lifecycle:** Visual card rendering (`MOD06`) and QR code matrix generation (`MOD07`) operate strictly on read-only, volatile RAM streams protected by a 120-second TTL zero-fill auto-purge protocol and startup memory residue checks.
3. **Sole Egress Gateway (`vCGE-MOD08`):** All external data sharing (Web Share API, `.vcf` downloads, high-res PNG QR exports, SMS/Email, and 3.5" x 2" physical printing) is strictly routed through a single, audited egress controller. Direct network calls from sub-modules are intercepted and blocked by the central container.

---

## 🚧 Current Status

**Working web prototype.** The app runs end-to-end in a browser:
- Scan or upload a card, then review and edit the contact.
- Preview the 3D card.
- Save it encrypted in the on-device vault.
- Share or export through MOD08.

All of this happens with no network access: the MOD01 gatekeeper and a Content-Security-Policy block every non-local request.

**Not done yet:**
- OCR and the QR code are placeholders until Tesseract.js and QRious are bundled. The app tells you when they are used.
- The Tauri v2 desktop build and OS keychain integration don't exist yet.

The full verified status is in [`docs/spec.md` §3](docs/spec.md#3-current-progress--verification-status).

## ▶️ Running locally

ES modules don't load from `file://`, so serve the folder over HTTP. This needs Node.js 18 or later and no other dependencies:

```bash
npm start            # serves http://localhost:8080 (localhost only; PORT=xxxx to change)
```

On first launch you either create a vault passphrase (8+ characters; it **cannot be recovered**) or choose *Continue without saving*.

---

## 📦 Repository Structure

```text
vCGE-Master/
├── LICENSE.md                     # MIT License
├── README.md
├── package.json                   # npm start (local server), npm run build:css (Tailwind 3.4.17, pinned)
├── tailwind.config.js
├── index.html                     # App UI (loads src/main.js as an ES module; CSP egress lock)
├── docs/
│   └── spec.md                    # Architecture brief & verification status
├── scripts/
│   └── serve.mjs                  # Dependency-free localhost static server
└── src/
    ├── main.js                    # Master Integration Controller (wires all modules over the event bus)
    ├── styles/                    # tailwind.input.css → tailwind.css (compiled, committed)
    ├── share/                     # Global Shared Libraries (vCGE-SHARE)
    │   ├── index.js               # Export barrel
    │   ├── cardSchema.js          # Canonical contact schema (CONTACT_FIELDS) & validation
    │   ├── cryptoUtils.js         # AES-GCM WebCrypto helpers
    │   ├── eventBus.js            # The single event bus + event names
    │   ├── regexMatchers.js       # Shared regex constants
    │   └── vcardFormatter.js      # The single vCard 3.0 builder (RFC 2426 escaping, CRLF)
    └── modules/                   # Isolated Core Functional Modules
        ├── mod01-shell/           # shell.js (network gatekeeper), themeManager.js (light/dark)
        ├── mod02-vault/           # vault.js (PBKDF2 + AES-GCM-256, lock/wipe), ttlManager.js (120 s TTL, not wired yet)
        ├── mod03-camera/          # camera.js (viewfinder, zoom, capture, crop review)
        ├── mod04-ocr/             # ocrWorker.js (image pre-processing + Tesseract.js hook; simulated until bundled)
        ├── mod05-form/            # formMapper.js (OCR text → contact), addressAutocomplete.js (local-only)
        ├── mod06-gui/             # card3dView.js (CardView: form, preview, palettes, avatar), cardStyles.css
        ├── mod07-qr/              # qrGenerator.js (vCard via shared builder, QR canvas render)
        └── mod08-egress/          # egressController.js (share, .vcf, QR PNG, mailto/sms, print + audit), print.css
```

**Planned, not yet present:** `vite.config.js`, `src-tauri/` + `tauri.conf.json`.

**Rebuilding the CSS:** after changing Tailwind classes in `index.html` or `src/**/*.js`, run `npm install` and then `npm run build:css`, and commit the updated `src/styles/tailwind.css`.

---

## 👥 Creators

raven575, Gemini & Claude

## 📄 License

[MIT](LICENSE.md). Pre-compiled binary distributions may additionally be offered under a separate commercial EULA (see [`docs/spec.md` §4](docs/spec.md#4-key-technical-decisions)).
