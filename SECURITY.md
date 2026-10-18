# Security Policy

vCGE (vCard Generator Engine) turns a business card into a contact card on your own device. Its whole design is about keeping that contact private. If you find a way around it, please tell us privately.

## Supported versions

vCGE is pre-release. Version numbers look like `0.MMM.BB`, for example `0.500.25`, followed by the commit hash.

| Version | Supported |
|---|---|
| The newest build on the default branch (`claude/kind-euler-zbkm30`) | Yes |
| Any older `0.x` build | No: please check the newest build first |

When 1.0 (the web release) ships, this table will list the supported releases.

## Reporting a vulnerability

**Please don't open a public issue, pull request or discussion for a security problem.**

Report it privately through GitHub:

1. Open the repository's **Security** tab.
2. Choose **Report a vulnerability**.
3. Describe what you found. Include the version shown in the app (`0.MMM.BB` and the commit hash), the browser or desktop build and device, the steps to reproduce, and what you expected to happen.

Only the maintainer sees the report. Please don't include real people's contact details. A made-up card shows the problem just as well.

## What to expect

- **Within 7 days:** a reply confirming we have the report.
- **Next:** we check it, tell you whether we can reproduce it, and agree on what counts as fixed.
- **Fix:** the fix goes into the next build. With your permission, you are credited in the advisory.
- **Disclosure:** please give us time to ship a fix before you publish. We publish a GitHub security advisory once a fix is out.

vCGE is made by one person (raven575) with AI assistance, so these times are goals, not guarantees.

## What vCGE promises

These are the rules a report can show to be broken:

1. **No internet.** The app never sends anything over the network by itself. A Content Security Policy and a network lock block every request to another host: `fetch`, XHR, WebSocket, EventSource and `sendBeacon`. The OCR reader runs on the device under the same rule.
2. **Your card is never stored.** Nothing you scan, upload or type is saved. Contact data lives in memory only. The app stores one small settings entry in `localStorage`, `vcge_settings`, which holds preferences only (hand, colours, theme, font, text size, wipe time) as numbers. If you turn on Face ID or fingerprint unlock, your browser saves a passkey for the site on the device. It holds no contact details.
3. **It wipes itself.** Leaving, closing or reloading the page wipes the card, the photo and the session PIN.
   - **Without a PIN:** 2 minutes without activity, or 30 seconds out of view, wipes it.
   - **With a 4-digit session PIN:** 2 idle minutes or the screen turning off lock it instead. While it is locked, the card is held encrypted in memory with a one-time AES-GCM key.
   - **After the lock:** it is wiped 7 minutes later (10 or 15 if chosen in Settings), or after 5 wrong PINs.
4. **Data leaves only when you choose.** A contact goes out only when you press Share, Save `.vcf`, QR, email, text or print, and only to the place you picked.

## In scope

- Any contact data, photo or OCR text leaving the device without the user pressing a share action.
- Any network request to another host from the app or its OCR worker.
- Anything stored beyond `vcge_settings` and the browser's own passkey: contact data, photos or text in `localStorage`, `sessionStorage`, IndexedDB, cookies, caches or files.
- Getting past the lock, the PIN or the wipe: unlocking without the PIN or passkey, a lock that doesn't hide the card, a wipe that leaves data behind, or a way to raise the wrong-PIN limit.
- Script injection, for example through text read from a card or a crafted `.vcf` or image.
- In the desktop app (Tauri): reaching any system command beyond the two the app allows.

## Out of scope

- An attacker who already controls the unlocked device, the browser or its extensions while the card is open.
- Someone reading the screen over your shoulder.
- What happens to a contact after you share it to another app, email or printer.
- Passkey handling inside the browser or operating system itself.
- Bugs in third-party browsers or engines, unless vCGE can reasonably work around them.
- Missing security headers on a test or lab server that isn't vcge.app.
- Reports from automated scanners with no working proof.

Thank you for helping keep vCGE private.
