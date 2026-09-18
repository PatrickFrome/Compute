!macro customInit
  InitPluginsDir
  File /oname=$PLUGINSDIR\metaengine-installer-shutdown.ps1 "${BUILD_RESOURCES_DIR}\installer-shutdown.ps1"

  IfFileExists "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 metaengine_installer_shutdown_done
  DetailPrint "Stopping the existing METAENGINE Browser instance..."
  ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\metaengine-installer-shutdown.ps1" -InstalledExe "$INSTDIR\${APP_EXECUTABLE_FILENAME}"' $0
  StrCmp $0 "0" metaengine_installer_shutdown_done

  IfSilent metaengine_installer_shutdown_abort 0
  MessageBox MB_ICONSTOP|MB_OK "METAENGINE Browser could not be stopped safely. Installation was stopped before replacing application files. Close METAENGINE Browser and try again."
metaengine_installer_shutdown_abort:
  Abort

metaengine_installer_shutdown_done:
!macroend
