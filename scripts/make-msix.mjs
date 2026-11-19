// Packs the Windows release build as an MSIX for the Microsoft Store: vcge.exe, its tile logos and AppxManifest.xml
// (from store/msix/AppxManifest.template.xml and store/msix/identity.json). The Store signs the package itself, so
// this script does not sign; CI signs a copy with a throwaway certificate only to test-install it.
// Usage (Windows, after `npx tauri build`): node scripts/make-msix.mjs [releaseFolder] [outFolder]
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** The Store wants four numbers and a last number of 0: "0.8.1" becomes "0.8.1.0". */
export function msixVersion(version) {
    const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
    if (!m) throw new Error(`version must be x.y.z: ${version}`);
    if (m.slice(1).some(n => Number(n) > 65535)) throw new Error(`each part must be 65535 or less: ${version}`);
    return `${m[1]}.${m[2]}.${m[3]}.0`;
}

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** AppxManifest.xml text: the template with the identity and version filled in. Throws if a value is left over. */
export function manifest(template, identity, version) {
    const values = {
        IDENTITY_NAME: identity.identityName, PUBLISHER: identity.publisher,
        PUBLISHER_DISPLAY_NAME: identity.publisherDisplayName, VERSION: msixVersion(version)
    };
    for (const [k, v] of Object.entries(values)) if (!v) throw new Error(`identity value missing: ${k}`);
    if (!/^CN=/.test(values.PUBLISHER)) throw new Error('publisher must start with CN=');
    const out = template.replace(/\{\{(\w+)\}\}/g, (all, k) => (k in values ? xml(values[k]) : all));
    const left = out.match(/\{\{\w+\}\}/);
    if (left) throw new Error(`unknown value in the template: ${left[0]}`);
    return out;
}

/** makeappx.exe from the newest Windows 10/11 SDK (GitHub's Windows runners have it). */
function makeappx() {
    const bin = 'C:\\Program Files (x86)\\Windows Kits\\10\\bin';
    const sdk = readdirSync(bin).filter(d => /^10\./.test(d) && existsSync(path.join(bin, d, 'x64', 'makeappx.exe')))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).pop();
    if (!sdk) throw new Error('makeappx.exe not found: install the Windows SDK');
    return path.join(bin, sdk, 'x64', 'makeappx.exe');
}

function run([release = path.join(ROOT, 'src-tauri/target/release'), out = path.join(release, 'bundle/msix')]) {
    const version = JSON.parse(readFileSync(path.join(ROOT, 'src-tauri/tauri.conf.json'), 'utf8')).version;
    const identity = JSON.parse(readFileSync(path.join(ROOT, 'store/msix/identity.json'), 'utf8'));
    const stage = path.join(release, 'msix-stage');
    rmSync(stage, { recursive: true, force: true });
    mkdirSync(path.join(stage, 'Assets'), { recursive: true });
    copyFileSync(path.join(release, 'vcge.exe'), path.join(stage, 'vcge.exe'));
    for (const logo of ['StoreLogo.png', 'Square150x150Logo.png', 'Square44x44Logo.png']) {
        copyFileSync(path.join(ROOT, 'src-tauri/icons', logo), path.join(stage, 'Assets', logo));
    }
    writeFileSync(path.join(stage, 'AppxManifest.xml'),
        manifest(readFileSync(path.join(ROOT, 'store/msix/AppxManifest.template.xml'), 'utf8'), identity, version));
    mkdirSync(out, { recursive: true });
    const file = path.join(out, `vCGE_${version}_x64.msix`);
    execFileSync(makeappx(), ['pack', '/o', '/d', stage, '/p', file], { stdio: 'inherit' });
    console.log(`MSIX: ${file}${identity.reserved ? '' : ' (test identity: not for the Store yet)'}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run(process.argv.slice(2));
