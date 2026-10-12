# Archive

`v0-gemini-import/` holds the original 23 source files of vCGE, created by raven575 & Gemini, exactly as imported on 2026-10-12 from the Google Drive export (`vCGE FILES/vCGE-Master`) in commit `d853f1d`. Each file keeps its original path, with `.v0` inserted before the extension (e.g. `src/modules/mod01-shell/shell.v0.js`). The contents are byte-for-byte unchanged, including their original attribution headers.

These files are kept for history only. They are not loaded, built or tested, and should not be run: they contain the defects fixed afterwards (wrong script paths, swapped contents of the two MOD06 files, a vault salt regenerated on every start, runtime CDN/network calls, plaintext storage and a default crypto key). The current versions live in `src/`, `index.html`, `README.md` and `LICENSE.md`; see `docs/spec.md` §3 for their verified status and `git log` for each fix.
