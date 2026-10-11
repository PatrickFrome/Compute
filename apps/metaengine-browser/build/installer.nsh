; Keep native installer controls and the existing installation lifecycle. Only
; the welcome copy, neutral colors and bundled artwork are customized here.
!define MUI_BGCOLOR "1d2026"
!define MUI_TEXTCOLOR "d4d7df"
!define MUI_INSTFILESPAGE_COLORS "d7dce5 252a32"
!define MUI_WELCOMEPAGE_TITLE "METAENGINE Browser"
!define MUI_WELCOMEPAGE_TEXT "Install version ${VERSION}.$\r$\n$\r$\nYour existing projects and client profile are preserved. The client connects to the configured local database automatically when it starts.$\r$\n$\r$\nChoose Next to continue."
!define MUI_FINISHPAGE_TITLE "METAENGINE Browser installed"
!define MUI_FINISHPAGE_TEXT "Version ${VERSION} is installed.$\r$\n$\r$\nOpen the client to review its current connection and work status."

!macro customWelcomePage
  !insertmacro MUI_PAGE_WELCOME
!macroend

; electron-builder calls this hook from the committed install/uninstall section,
; before uninstalling the old version or extracting replacement files. Opening
; or cancelling the assisted installer's welcome page must not stop the client.
; customInstall is too late: that hook runs after installApplicationFiles.
!macro customCheckAppRunning
  InitPluginsDir
  File /oname=$PLUGINSDIR\metaengine-installer-shutdown.ps1 "${BUILD_RESOURCES_DIR}\installer-shutdown.ps1"

  ; Even a missing Browser executable can leave exact packaged runtime processes.
  ; The helper confirms absence or completes bounded managed cleanup in both cases.
  DetailPrint "Checking the existing METAENGINE Browser runtime..."
  ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "$PLUGINSDIR\metaengine-installer-shutdown.ps1" -InstalledExe "$INSTDIR\${APP_EXECUTABLE_FILENAME}"' $0
  StrCmp $0 "0" metaengine_installer_shutdown_done

  IfSilent metaengine_installer_shutdown_abort 0
  MessageBox MB_ICONSTOP|MB_OK "METAENGINE Browser could not be stopped safely. Installation was stopped before replacing application files. Close METAENGINE Browser and try again."
metaengine_installer_shutdown_abort:
  Abort

metaengine_installer_shutdown_done:
!macroend
