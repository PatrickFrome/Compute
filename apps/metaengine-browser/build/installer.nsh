; Keep native installer controls and the existing installation lifecycle. Only
; the welcome copy, neutral colors and bundled artwork are customized here.
!define MUI_BGCOLOR "1d2026"
!define MUI_TEXTCOLOR "d4d7df"
!define MUI_INSTFILESPAGE_COLORS "d7dce5 252a32"
!define MUI_WELCOMEPAGE_TITLE "METAENGINE Browser"
!define MUI_WELCOMEPAGE_TEXT "Install version ${VERSION}.$\r$\n$\r$\nThis installer supports a fresh installation only. An existing installation requires the separately verified migration procedure. Do not delete its files or registration to bypass this check.$\r$\n$\r$\nChoose Next to continue."
!define MUI_FINISHPAGE_TITLE "METAENGINE Browser installed"
!define MUI_FINISHPAGE_TEXT "Version ${VERSION} is installed.$\r$\n$\r$\nOpen the client to complete setup and review its connection and work status. Installation alone does not confirm that the runtime is ready."

; MUI initializes its branding controls before this supported callback. Color
; the outer dialog too, so the footer does not flash white against the pages.
!define MUI_CUSTOMFUNCTION_GUIINIT metaengineInstallerGuiInit
Function metaengineInstallerGuiInit
  Push $0
  SetCtlColors $HWNDPARENT "${MUI_TEXTCOLOR}" "${MUI_BGCOLOR}"
  GetDlgItem $0 $HWNDPARENT 1028
  SetCtlColors $0 "${MUI_TEXTCOLOR}" "${MUI_BGCOLOR}"
  GetDlgItem $0 $HWNDPARENT 1256
  SetCtlColors $0 "${MUI_TEXTCOLOR}" "${MUI_BGCOLOR}"

  ; Keep the OS caption and keyboard-accessible buttons. Unsupported DWM
  ; attributes return an error and leave the native caption available.
  System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 20, *i 1, i 4) i.r0'
  StrCmp $0 "0" metaengine_installer_dark_caption_ready
  System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 19, *i 1, i 4) i.r0'
metaengine_installer_dark_caption_ready:
  System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 35, *i 0x0026201d, i 4) i.r0'
  System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 36, *i 0x00dfd7d4, i 4) i.r0'
  Pop $0
FunctionEnd

!macro customWelcomePage
  !insertmacro MUI_PAGE_WELCOME
!macroend

; electron-builder calls this hook from the committed install/uninstall section,
; before uninstalling the old version or extracting replacement files. Opening
; or cancelling the assisted installer's welcome page must not stop the client.
; customInstall is too late: that hook runs after installApplicationFiles.
!macro customCheckAppRunning
  ; The old uninstaller is executable code too. Only fresh installation is
  ; qualified here; do not let a successful file-use check launch an old helper.
  !ifndef BUILD_UNINSTALLER
    !define METAENGINE_FRESH_INSTALL_ARGS '-RequireFreshInstall -InstallRegistryKey "${INSTALL_REGISTRY_KEY}" -UninstallRegistryKey "${UNINSTALL_REGISTRY_KEY}"'
    !ifdef UNINSTALL_REGISTRY_KEY_2
      !define METAENGINE_FRESH_INSTALL_EXTRA_ARGS '-UninstallRegistryKey2 "${UNINSTALL_REGISTRY_KEY_2}"'
    !else
      !define METAENGINE_FRESH_INSTALL_EXTRA_ARGS ''
    !endif
  !else
    !define METAENGINE_FRESH_INSTALL_ARGS ''
    !define METAENGINE_FRESH_INSTALL_EXTRA_ARGS ''
  !endif
  InitPluginsDir
  File /oname=$PLUGINSDIR\metaengine-installer-shutdown.ps1 "${BUILD_RESOURCES_DIR}\installer-shutdown.ps1"

  ; Even a missing Browser executable can leave exact packaged runtime processes.
  ; The helper is a read-only file-use gate. It never signals an unqualified old
  ; shutdown handler or treats disappearance as a worker-tree cleanup receipt.
  DetailPrint "Checking that the existing METAENGINE Browser files are not in use..."
  ClearErrors
  ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "$PLUGINSDIR\metaengine-installer-shutdown.ps1" -InstalledExe "$INSTDIR\${APP_EXECUTABLE_FILENAME}" ${METAENGINE_FRESH_INSTALL_ARGS} ${METAENGINE_FRESH_INSTALL_EXTRA_ARGS}' $0
  IfErrors metaengine_installer_shutdown_failed
  StrCmp $0 "0" metaengine_installer_shutdown_done

metaengine_installer_shutdown_failed:

  IfSilent metaengine_installer_shutdown_abort 0
  MessageBox MB_ICONSTOP|MB_OK "An existing installation, registration, live runtime, or unverified state prevents this operation. Installation was stopped before replacing application files. Existing installations require a separately reviewed migration, including their old uninstaller. Do not delete the Owner profile or database, or retry an ambiguous operation."
metaengine_installer_shutdown_abort:
  Abort

metaengine_installer_shutdown_done:
  !undef METAENGINE_FRESH_INSTALL_ARGS
  !undef METAENGINE_FRESH_INSTALL_EXTRA_ARGS
!macroend
