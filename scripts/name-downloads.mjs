// Names each test download after the release version, the platform and the build (raven575, 2026-11-15):
// "vCGE-0.8.1-W417_x64-setup.exe", "vCGE-0.8.1-A417.apk". The letter says the platform (A Android, I iOS, W Windows,
// L Linux, M macOS) and the number is the CI run, the same for every platform built in that run, so downloads from
// different builds can sit side by side. The app's own version number is not changed.
// Usage: node scripts/name-downloads.mjs <folder> <A|I|W|L|M> <build number>
import { readdirSync, renameSync, statSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLATFORMS = { A: 'Android', I: 'iOS', W: 'Windows', L: 'Linux', M: 'macOS' };

/** The tag for one build: "0.8.1-W417". */
export function buildTag(version, platform, build) {
    if (!PLATFORMS[platform]) throw new Error(`unknown platform letter: ${platform}`);
    if (!/^\d+$/.test(String(build))) throw new Error(`build must be a number: ${build}`);
    return `${version}-${platform}${build}`;
}

/**
 * The new name for one file: Tauri's "vCGE_0.8.1_x64-setup.exe" becomes "vCGE-0.8.1-W417_x64-setup.exe" (what follows
 * the version stays: it says the chip and the kind of installer). Any other file becomes "vCGE-0.8.1-W417<ext>".
 * Folders (macOS's vCGE.app) and files already named are left alone.
 */
export function downloadName(file, version, platform, build) {
    const tag = buildTag(version, platform, build);
    if (file.startsWith(`vCGE-${tag}`)) return file;
    const tauri = `vCGE_${version}`;
    if (file.startsWith(tauri)) return `vCGE-${tag}${file.slice(tauri.length)}`;
    return `vCGE-${tag}${path.extname(file)}`;
}

function run([folder, platform, build]) {
    const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
    const dirs = [folder, ...readdirSync(folder).map(d => path.join(folder, d)).filter(d => statSync(d).isDirectory())];
    let renamed = 0;   // files named (now or by an earlier run)
    for (const dir of dirs) {
        for (const file of readdirSync(dir)) {
            const from = path.join(dir, file);
            if (!statSync(from).isFile() || file.startsWith('.')) continue;
            const to = path.join(dir, downloadName(file, version, platform, build));
            renamed++;
            if (to === from) continue;
            renameSync(from, to);
            console.log(`${path.relative(folder, from)} -> ${path.relative(folder, to)}`);
        }
    }
    if (!renamed) { console.error(`No downloads to name in ${folder}`); process.exit(1); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run(process.argv.slice(2));
