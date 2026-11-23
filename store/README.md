# vCGE in app stores

Everything a store form asks for, kept in one place. Listing text: [`listing.json`](listing.json) (checked by `npm run test:wrappers`). Privacy policy: [`../PRIVACY.md`](../PRIVACY.md).

| | Google Play | Microsoft Store |
|---|---|---|
| Package / identity | `app.vcge.vcge` (can never change) | Reserved name "vCGE" in Partner Center |
| Upload format | Signed Android App Bundle (`.aab`), `npx tauri android build --aab` | MSIX (the Store signs it) |
| Price | 0.99 USD, paid up front | 0.99 USD |
| Category | Business | Business |
| Privacy policy URL | `privacyPolicyUrl` in listing.json | same |

## Google Play: Data safety form

- Does the app collect or share any of the required user data types? **No.**
- Why: photos are read on the device and never leave it unless the person presses Share, Save, Email, Text or Print. Google counts data processed only on the device, and transfers the person starts themselves, as neither collected nor shared.
- Is all data encrypted in transit? Not applicable (no network: the release manifest has no INTERNET permission).
- Can people ask for data to be deleted? Not applicable: nothing is kept. Settings are cleared by clearing the app's storage or uninstalling.

## Google Play: other forms

- **Sign in details (was App access):** answer **Yes** (Google's Yes list names QR codes, PINs and biometrics), name "No sign-in needed", no username or password, and this note (445 of 500 characters): "No account, sign-in or network access. Every feature works right after install. The PIN and fingerprint lock are optional and off until the user turns them on in the Vault: skip them, or set any 4-digit PIN to test. QR codes are made by the app from the scanned card; nothing needs scanning from elsewhere. To test without a camera, tap \"Play with sample fields\" on the first screen, or tap Photo and pick any picture of a made-up business card."
