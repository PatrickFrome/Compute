$ErrorActionPreference = 'Stop'

$setup = Get-ChildItem dist-installer\METAENGINE-Browser-TEST-Setup-*.exe | Select-Object -First 1
if (-not $setup) { throw 'installer_exe_missing' }

$install = Start-Process -FilePath $setup.FullName -ArgumentList '/S' -PassThru
if (-not $install.WaitForExit(60000)) { try { $install.Kill($true) } catch {}; throw 'installer_silent_install_timeout' }
if ($install.ExitCode -ne 0) { throw "installer_silent_install_exit_$($install.ExitCode)" }

$installedExe = Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Programs') -Filter 'METAENGINE Browser TEST.exe' -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $installedExe) { throw 'installed_browser_exe_not_found' }

$startupReceipt = Join-Path $env:RUNNER_TEMP 'metaengine-installed-startup.json'
Remove-Item $startupReceipt -Force -ErrorAction SilentlyContinue
$env:METAENGINE_STARTUP_RECEIPT = $startupReceipt
$appOut = Join-Path $env:RUNNER_TEMP 'metaengine-installed-out.txt'
$appErr = Join-Path $env:RUNNER_TEMP 'metaengine-installed-err.txt'
$app = Start-Process -FilePath $installedExe.FullName -PassThru -RedirectStandardOutput $appOut -RedirectStandardError $appErr

$deadline = (Get-Date).AddSeconds(20)
while ((Get-Date) -lt $deadline -and -not (Test-Path $startupReceipt)) {
  Start-Sleep -Milliseconds 250
}
if (-not (Test-Path $startupReceipt)) {
  Get-Content $appOut -ErrorAction SilentlyContinue
  Get-Content $appErr -ErrorAction SilentlyContinue
  if (-not $app.HasExited) { try { $app.Kill($true) } catch {} }
  throw 'installed_browser_startup_receipt_missing'
}

$receipt = Get-Content $startupReceipt -Raw | ConvertFrom-Json
Get-Content $startupReceipt
if ($receipt.schema -ne 'metaengine.browser.startup-receipt.v1') { throw 'installed_browser_startup_schema_invalid' }
if ($receipt.status -ne 'READY') { throw "installed_browser_startup_status_$($receipt.status)" }
if ($receipt.app_packaged -ne $true) { throw 'installed_browser_not_packaged' }
if ([int]$receipt.window_count -lt 1) { throw 'installed_browser_window_missing' }
if ([int]$receipt.visible_window_count -lt 1 -or $receipt.window_visible -ne $true) { throw 'installed_browser_window_not_visible' }
if ($receipt.authority_effect -ne $false) { throw 'installed_browser_startup_authority_invalid' }

"installer=$($setup.Name)" | Set-Content dist-installer\INSTALLER_RECEIPT.txt
"sha256=$((Get-FileHash $setup.FullName -Algorithm SHA256).Hash.ToLowerInvariant())" | Add-Content dist-installer\INSTALLER_RECEIPT.txt
"installed_exe=$($installedExe.FullName)" | Add-Content dist-installer\INSTALLER_RECEIPT.txt
"installed_launch=PASS" | Add-Content dist-installer\INSTALLER_RECEIPT.txt
"startup_status=$($receipt.status)" | Add-Content dist-installer\INSTALLER_RECEIPT.txt
"visible_window_count=$($receipt.visible_window_count)" | Add-Content dist-installer\INSTALLER_RECEIPT.txt
Copy-Item $startupReceipt dist-installer\INSTALLED_STARTUP_RECEIPT.json

if (-not $app.HasExited) {
  try { $app.CloseMainWindow() | Out-Null } catch {}
  Start-Sleep -Seconds 1
  if (-not $app.HasExited) { try { $app.Kill($true) } catch {} }
}
