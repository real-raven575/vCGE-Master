; Quick Scan (raven575, 2026-11-24): the Windows installer adds a second Start menu entry, "vCGE Quick Scan", that starts
; vCGE with --quick-scan (src-tauri/src/lib.rs). The uninstaller removes it again. Nothing else is added.
!macro NSIS_HOOK_POSTINSTALL
  CreateShortcut "$SMPROGRAMS\vCGE Quick Scan.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "--quick-scan" "$INSTDIR\${MAINBINARYNAME}.exe" 0
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  Delete "$SMPROGRAMS\vCGE Quick Scan.lnk"
!macroend
