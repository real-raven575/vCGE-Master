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

**Prototype — not yet runnable end-to-end.** The architecture is designed and each module exists on its own, but nothing integrates them yet:

- `index.html` loads only MOD01, and `src/main.js` (the integration controller) is empty.
- There are no `package.json`, Vite or Tauri config files yet.
- OCR and QR rendering are simulated.
- Several privacy guarantees above aren't enforced yet: there are direct network calls outside MOD08 and plaintext `localStorage` writes.

The full verified findings list is in [`docs/spec.md` §3](docs/spec.md#3-current-progress--verification-status).

---

## 📦 Repository Structure

```text
vCGE-Master/
├── LICENSE.md                     # MIT License
├── README.md
├── index.html                     # Master Container Shell (vCGE-MOD01 UI)
├── docs/
│   └── spec.md                    # Architecture brief & verification status
└── src/
    ├── main.js                    # Master Integration Controller (empty — not yet written)
    ├── share/                     # Global Shared Libraries (vCGE-SHARE)
    │   ├── index.js               # Export barrel
    │   ├── cardSchema.js          # Contact schema & validation
    │   ├── cryptoUtils.js         # AES-GCM WebCrypto helpers
    │   ├── eventBus.js            # Pub/Sub event bus
    │   ├── regexMatchers.js       # OCR text heuristics
    │   └── vcardFormatter.js      # vCard 3.0 formatter
    └── modules/                   # Isolated Core Functional Modules
        ├── mod01-shell/           # shell.js (Pub/Sub broker, gatekeeper), themeManager.js
        ├── mod02-vault/           # vault.js (PBKDF2 + AES-GCM-256), ttlManager.js (120 s TTL)
        ├── mod03-camera/          # camera.js (viewfinder, zoom, capture, crop review)
        ├── mod04-ocr/             # ocrWorker.js (Tesseract.js WASM pipeline)
        ├── mod05-form/            # formMapper.js, addressAutocomplete.js
        ├── mod06-gui/             # card3dView.js (card logic, theming, presets), cardStyles.css
        ├── mod07-qr/              # qrGenerator.js (vCard 3.0 builder, QR canvas, PNG/VCF export)
        └── mod08-egress/          # egressController.js (Web Share, .vcf, mailto/sms, print), print.css
```

**Planned, not yet present:** `package.json`, `vite.config.js`, `src-tauri/` + `tauri.conf.json`, `src/styles/main.css`.

---

## 👥 Creators

raven575, Gemini & Claude

## 📄 License

[MIT](LICENSE.md). Pre-compiled binary distributions may additionally be offered under a separate commercial EULA (see [`docs/spec.md` §4](docs/spec.md#4-key-technical-decisions)).
