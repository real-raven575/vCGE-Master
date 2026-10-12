# vCard Generator Engine (vCGE)

> **Zero-Trust, Offline-First, Privacy-Focused Digital Business Card Ecosystem**

The **vCard Generator Engine (vCGE)** is a high-security, cross-platform digital business card processing system. Built on a modular ES Architecture and powered by Tauri v2, vCGE processes physical business cards via hardware camera feeds or local file uploads, parses text locally via WebAssembly OCR, and generates interactive 3D business cards with scannable vCard QR codes—all without leaving your device.

---

## 🔑 Core Architectural Tenets

1. **The Vault Principle (`vCGE-MOD02`):** All personal contact data, OCR text arrays, and card assets are encrypted at rest using AES-GCM-256 (PBKDF2-HMAC-SHA256) with native OS Keychain integration (macOS Keychain, Windows DPAPI, Linux Libsecret).
2. **Ephemeral Memory Lifecycle:** Visual card rendering (`MOD06`) and QR code matrix generation (`MOD07`) operate strictly on read-only, volatile RAM streams protected by a 120-second TTL zero-fill auto-purge protocol and startup memory residue checks.
3. **Sole Egress Gateway (`vCGE-MOD08`):** All external data sharing (Web Share API, `.vcf` downloads, high-res PNG QR exports, SMS/Email, and 3.5" x 2" physical printing) is strictly routed through a single, audited egress controller. Direct network calls from sub-modules are intercepted and blocked by the central container.

---

## 📦 Repository Structure

```text
vCGE-Master/
├── LICENSE
├── README.md
├── package.json
├── tauri.conf.json
├── index.html                     # Master Container Shell (vCGE-MOD01)
├── src/
│   ├── main.js                    # Master Integration Controller
│   ├── styles/
│   │   ├── main.css               # UI Typography & Styling
│   │   └── print.css              # 3.5" x 2" Physical Card Print Stylesheet
│   ├── share/                     # Global Shared Libraries (vCGE-SHARE)
│   │   ├── index.js
│   │   ├── cardSchema.js
│   │   ├── cryptoUtils.js
│   │   ├── regexMatchers.js
│   │   ├── vcardFormatter.js
│   │   └── eventBus.js
│   └── modules/                   # Isolated Core Functional Modules
│       ├── mod01-shell/           # Container Shell & Pub/Sub Broker
│       ├── mod02-vault/           # AES-256 Storage Engine & TTL Manager
│       ├── mod03-camera/          # Active Viewfinder & Image Pre-processing
│       ├── mod04-ocr/             # On-Device WASM Tesseract.js OCR Engine
│       ├── mod05-form/            # Schema Mapper & Address Autocomplete
│       ├── mod06-gui/             # Interactive 3D Card Flip Renderer
│       ├── mod07-qr/              # Offline vCard 3.0 Syntax & Canvas QR Matrix
│       └── mod08-egress/          # Outbound Sharing & Security Gatekeeper