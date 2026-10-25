import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { lstatSync, realpathSync, unlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { protectOwnerOnlyWindowsDirectory } from './private-windows-storage-acl.mjs';
import {
  computerAuthorityPlaneSnapshot,
  computerTargetIdentityDigest,
  hasAdmissibleEffectReadback,
  normalizeComputerRequest,
  projectComputerEffectReceipt,
} from './computer-authority-plane.mjs';

const MAX_STDOUT_BYTES = 8 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15000;
const BRIDGE_PHASES = Object.freeze(['SCRIPT_ENTER','MODULES_READY','REQUEST_READ',
  'FORMS_BEGIN','FORMS_READY','DRAWING_BEGIN','DRAWING_READY','UIA_BEGIN','UIA_READY',
  'NATIVE_TYPE_BEGIN','NATIVE_TYPE_READY','ACTION_BEGIN','ACTION_END']);

const POWERSHELL_BRIDGE = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
function Write-BridgePhase([string]$Phase) {
  [Console]::Error.WriteLine('ME_PC_BRIDGE_V1 ' + $Phase)
  [Console]::Error.Flush()
}
Write-BridgePhase 'SCRIPT_ENTER'

# Resolve the two required cmdlet modules directly from the OS installation,
# without relying on auto-discovery in this request's fresh temporary profile.
Import-Module ([IO.Path]::Combine($PSHOME,'Modules','Microsoft.PowerShell.Utility')) -ErrorAction Stop
Import-Module ([IO.Path]::Combine($PSHOME,'Modules','Microsoft.PowerShell.Management')) -ErrorAction Stop
Write-BridgePhase 'MODULES_READY'
$requestPath = [string]$env:METAENGINE_COMPUTER_REQUEST_PATH
if (-not $requestPath) { throw "computer_request_path_missing" }
$request = Get-Content -Raw -LiteralPath $requestPath | ConvertFrom-Json
Write-BridgePhase 'REQUEST_READ'

function Write-Result([object]$Value) {
  [Console]::Out.WriteLine(($Value | ConvertTo-Json -Depth 16 -Compress))
}

function Sha256-String([string]$Value) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Value)
    return ([System.BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant()
  } finally {
    $sha.Dispose()
  }
}

if ($request.action -in @('OBSERVE_DISPLAYS','CAPTURE_DESKTOP')) {
  Write-BridgePhase 'FORMS_BEGIN'
  Add-Type -AssemblyName System.Windows.Forms
  Write-BridgePhase 'FORMS_READY'
}
if ($request.action -in @('CAPTURE_DESKTOP','CAPTURE_WINDOW','POINTER_CLICK')) {
  Write-BridgePhase 'DRAWING_BEGIN'
  Add-Type -AssemblyName System.Drawing
  Write-BridgePhase 'DRAWING_READY'
}
if ($request.action -in @('UIA_SNAPSHOT','UIA_FOCUS','UIA_INVOKE','UIA_SET_VALUE','UIA_TOGGLE','UIA_SELECT','UIA_EXPAND_COLLAPSE','UIA_SCROLL','TYPE_TEXT')) {
  Write-BridgePhase 'UIA_BEGIN'
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  Write-BridgePhase 'UIA_READY'
}

if ($request.action -notin @('STATUS','OBSERVE_DISPLAYS')) {
Write-BridgePhase 'NATIVE_TYPE_BEGIN'
Add-Type -TypeDefinition @"
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;

public static class MetaengineWin32 {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int X; public int Y; }

  [StructLayout(LayoutKind.Sequential)]
  public struct INPUT {
    public uint type;
    public InputUnion U;
  }

  [StructLayout(LayoutKind.Explicit)]
  public struct InputUnion {
    [FieldOffset(0)] public MOUSEINPUT mi;
    [FieldOffset(0)] public KEYBDINPUT ki;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct MOUSEINPUT {
    public int dx;
    public int dy;
    public uint mouseData;
    public uint dwFlags;
    public uint time;
    public UIntPtr dwExtraInfo;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct KEYBDINPUT {
    public ushort wVk;
    public ushort wScan;
    public uint dwFlags;
    public uint time;
    public UIntPtr dwExtraInfo;
  }

  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT point);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hWnd, uint gaFlags);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT point);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
  [DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint count, INPUT[] inputs, int size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inheritHandle, uint processId);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool QueryFullProcessImageName(IntPtr process, uint flags, StringBuilder path, ref uint size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool CloseHandle(IntPtr handle);

  const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

  public static string GetProcessImagePath(uint processId) {
    var handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, processId);
    if (handle == IntPtr.Zero) return null;
    try {
      uint size = 32768;
      var path = new StringBuilder((int)size);
      if (!QueryFullProcessImageName(handle, 0, path, ref size)) return null;
      return path.ToString();
    } finally {
      CloseHandle(handle);
    }
  }

  public static string GetFileSha256(string filePath) {
    if (String.IsNullOrWhiteSpace(filePath)) return null;
    try {
      using (var stream = new FileStream(
        filePath,
        FileMode.Open,
        FileAccess.Read,
        FileShare.ReadWrite | FileShare.Delete
      )) {
        using (var sha = SHA256.Create()) {
          var digest = sha.ComputeHash(stream);
          var result = new StringBuilder(digest.Length * 2);
          foreach (var value in digest) result.Append(value.ToString("x2"));
          return result.ToString();
        }
      }
    } catch {
      return null;
    }
  }

  public static string GetProcessImageSha256(uint processId) {
    return GetFileSha256(GetProcessImagePath(processId));
  }

  const uint INPUT_KEYBOARD = 1;
  const uint KEYEVENTF_KEYUP = 0x0002;
  const uint KEYEVENTF_UNICODE = 0x0004;

  static INPUT Key(ushort vk, ushort scan, uint flags) {
    var input = new INPUT();
    input.type = INPUT_KEYBOARD;
    input.U.ki = new KEYBDINPUT { wVk = vk, wScan = scan, dwFlags = flags, time = 0, dwExtraInfo = UIntPtr.Zero };
    return input;
  }

  public static bool SendUnicode(string text) {
    if (text == null) return false;
    foreach (char c in text) {
      var inputs = new INPUT[] {
        Key(0, c, KEYEVENTF_UNICODE),
        Key(0, c, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP)
      };
      if (SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT))) != inputs.Length) return false;
    }
    return true;
  }

  public static bool SendVirtualKey(ushort vk) {
    var inputs = new INPUT[] { Key(vk, 0, 0), Key(vk, 0, KEYEVENTF_KEYUP) };
    return SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT))) == inputs.Length;
  }

  public static bool SendCtrlA() {
    const ushort VK_CONTROL = 0x11;
    const ushort VK_A = 0x41;
    var inputs = new INPUT[] {
      Key(VK_CONTROL, 0, 0),
      Key(VK_A, 0, 0),
      Key(VK_A, 0, KEYEVENTF_KEYUP),
      Key(VK_CONTROL, 0, KEYEVENTF_KEYUP)
    };
    return SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT))) == inputs.Length;
  }
}
"@
Write-BridgePhase 'NATIVE_TYPE_READY'
}

function Get-MachineFingerprint {
  $machineGuid = $null
  try {
    $machineGuid = [Microsoft.Win32.Registry]::GetValue(
      'HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Cryptography',
      'MachineGuid',
      $null
    )
  } catch {}
  $material = "$($env:COMPUTERNAME)|windows|$([string]$machineGuid)"
  return Sha256-String $material
}

function Get-ProcessIdentity([int]$ProcessId) {
  $p = Get-Process -Id $ProcessId -ErrorAction Stop
  $hwnd = [Int64]$p.MainWindowHandle
  if ($hwnd -le 0) { throw "computer_target_window_missing" }
  $start = [DateTimeOffset]::new($p.StartTime.ToUniversalTime()).ToUnixTimeMilliseconds()
  $exeHash = $null
  try { $exeHash = [MetaengineWin32]::GetProcessImageSha256([UInt32]$p.Id) } catch {}
  if (-not $exeHash) {
    $exePath = $null
    try {
      if ($p.Path) { $exePath = [string]$p.Path }
    } catch {}
    if (-not $exePath) {
      try { $exePath = [MetaengineWin32]::GetProcessImagePath([UInt32]$p.Id) } catch {}
    }
    if ($exePath) {
      try { $exeHash = [MetaengineWin32]::GetFileSha256([string]$exePath) } catch {}
    }
  }
  if (-not $exeHash) { throw "computer_target_executable_hash_unavailable" }
  $generation = [Int64](($start % 2147483646) + 1)
  return [ordered]@{
    schema = 'metaengine.computer-target-identity.v1'
    machine_fingerprint_sha256 = Get-MachineFingerprint
    session_id = [int]$p.SessionId
    process_id = [int]$p.Id
    process_creation_time_ms = [Int64]$start
    window_handle = ('0x{0:x}' -f $hwnd)
    executable_sha256 = $exeHash
    generation = $generation
    authority_effect = $false
  }
}

function Assert-TargetIdentity([object]$Expected) {
  if (-not $Expected) { throw "computer_target_identity_required" }
  $actual = Get-ProcessIdentity ([int]$Expected.process_id)
  foreach ($field in @('machine_fingerprint_sha256','session_id','process_id','process_creation_time_ms','window_handle','executable_sha256','generation')) {
    if ([string]$actual[$field] -ne [string]$Expected.$field) {
      throw "computer_target_identity_drift:$field"
    }
  }
  return $actual
}

function Get-WindowRectForIdentity([object]$Identity) {
  $rect = New-Object MetaengineWin32+RECT
  $hwnd = [IntPtr]([Convert]::ToInt64(([string]$Identity.window_handle).Substring(2), 16))
  if (-not [MetaengineWin32]::GetWindowRect($hwnd, [ref]$rect)) { throw "computer_window_rect_unavailable" }
  return [ordered]@{
    left = $rect.Left
    top = $rect.Top
    right = $rect.Right
    bottom = $rect.Bottom
    width = $rect.Right - $rect.Left
    height = $rect.Bottom - $rect.Top
  }
}

function Assert-PointTargetsWindow([int]$ScreenX,[int]$ScreenY,[IntPtr]$ExpectedRoot,[string]$Reason) {
  $point = New-Object MetaengineWin32+POINT
  $point.X = $ScreenX
  $point.Y = $ScreenY
  $hit = [MetaengineWin32]::WindowFromPoint($point)
  if ($hit -eq [IntPtr]::Zero) { throw $Reason }
  $root = [MetaengineWin32]::GetAncestor($hit, 2)
  if ($root -eq [IntPtr]::Zero) { $root = $hit }
  if ($root -ne $ExpectedRoot) { throw $Reason }
  return $true
}

function RuntimeId-Equal([int[]]$A, [object[]]$B) {
  if (-not $A -or -not $B -or $A.Length -ne $B.Count) { return $false }
  for ($i=0; $i -lt $A.Length; $i++) {
    if ([int]$A[$i] -ne [int]$B[$i]) { return $false }
  }
  return $true
}

function Get-UiaRoot([object]$Identity) {
  $hwnd = [IntPtr]([Convert]::ToInt64(([string]$Identity.window_handle).Substring(2), 16))
  $root = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
  if (-not $root) { throw "computer_uia_root_unavailable" }
  return $root
}

function Find-UiaElement([object]$Identity, [object[]]$RuntimeId) {
  $root = Get-UiaRoot $Identity
  if (RuntimeId-Equal $root.GetRuntimeId() $RuntimeId) { return $root }
  $all = $root.FindAll(
    [System.Windows.Automation.TreeScope]::Descendants,
    [System.Windows.Automation.Condition]::TrueCondition
  )
  foreach ($el in $all) {
    try {
      if (RuntimeId-Equal $el.GetRuntimeId() $RuntimeId) { return $el }
    } catch {}
  }
  throw "computer_uia_runtime_id_not_found"
}

function Project-Uia([System.Windows.Automation.AutomationElement]$Element) {
  $rect = $Element.Current.BoundingRectangle
  $runtime = @()
  $patterns = @()
  try { $runtime = @($Element.GetRuntimeId()) } catch {}
  try { $patterns = @($Element.GetSupportedPatterns() | ForEach-Object { [string]$_.ProgrammaticName }) } catch {}
  return [ordered]@{
    runtime_id = $runtime
    name = [string]$Element.Current.Name
    automation_id = [string]$Element.Current.AutomationId
    control_type = [string]$Element.Current.ControlType.ProgrammaticName
    class_name = [string]$Element.Current.ClassName
    supported_patterns = $patterns
    enabled = [bool]$Element.Current.IsEnabled
    offscreen = [bool]$Element.Current.IsOffscreen
    bounds = [ordered]@{
      x = [double]$rect.X
      y = [double]$rect.Y
      width = [double]$rect.Width
      height = [double]$rect.Height
    }
  }
}

function Resolve-ScrollAmount([string]$Value) {
  switch (([string]$Value).ToUpperInvariant()) {
    'LARGE_DECREMENT' { return [System.Windows.Automation.ScrollAmount]::LargeDecrement }
    'SMALL_DECREMENT' { return [System.Windows.Automation.ScrollAmount]::SmallDecrement }
    'NO_AMOUNT' { return [System.Windows.Automation.ScrollAmount]::NoAmount }
    'LARGE_INCREMENT' { return [System.Windows.Automation.ScrollAmount]::LargeIncrement }
    'SMALL_INCREMENT' { return [System.Windows.Automation.ScrollAmount]::SmallIncrement }
    default { throw "computer_uia_scroll_amount_invalid" }
  }
}

function Get-BitmapPixelSha256([System.Drawing.Bitmap]$Bitmap) {
  $rect = [System.Drawing.Rectangle]::new(0,0,$Bitmap.Width,$Bitmap.Height)
  $data = $Bitmap.LockBits(
    $rect,
    [System.Drawing.Imaging.ImageLockMode]::ReadOnly,
    [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
  )
  try {
    $length = [Math]::Abs([int]$data.Stride) * [int]$Bitmap.Height
    $bytes = New-Object byte[] $length
    [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0,$bytes,0,$length)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
      return ([System.BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant()
    } finally {
      $sha.Dispose()
    }
  } finally {
    $Bitmap.UnlockBits($data)
  }
}

$effectStarted = $false

try {
  Write-BridgePhase 'ACTION_BEGIN'
  switch ([string]$request.action) {
    'STATUS' {
      Write-Result ([ordered]@{
        ok = $true
        effect_started = $false
        schema = 'metaengine.windows-computer-executor.status.v1'
        available = $true
        platform = 'win32'
        machine_fingerprint_sha256 = Get-MachineFingerprint
        session_id = [int]([System.Diagnostics.Process]::GetCurrentProcess().SessionId)
        typed_actions_only = $true
        arbitrary_shell = $false
        raw_powershell_command_input = $false
        authority_effect = $false
      })
      break
    }

    'OBSERVE_WINDOWS' {
      $limit = [Math]::Max(1, [Math]::Min(256, [int]$request.args.limit))
      $offset = [Math]::Max(0, [int]$request.args.offset)
      $windows = @()
      $rejected = @()
      $eligible = @(Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | Sort-Object Id)
      foreach ($p in @($eligible | Select-Object -Skip $offset -First $limit)) {
        try {
          $identity = Get-ProcessIdentity $p.Id
          $rect = Get-WindowRectForIdentity $identity
          $windows += [ordered]@{
            identity = $identity
            title = [string]$p.MainWindowTitle
            process_name = [string]$p.ProcessName
            rect = $rect
          }
        } catch {
          if ($rejected.Count -lt 16) {
            $rejected += [ordered]@{
              process_id = [int]$p.Id
              process_name = [string]$p.ProcessName
              title = [string]$p.MainWindowTitle
              error = ([string]$_.Exception.Message).Substring(0,[Math]::Min(240,([string]$_.Exception.Message).Length))
            }
          }
        }
      }
      Write-Result ([ordered]@{
        ok = $true
        effect_started = $false
        schema = 'metaengine.windows-computer-executor.windows.v1'
        windows = $windows
        count = $windows.Count
        rejected_windows = $rejected
        rejected_count = $rejected.Count
        offset = $offset
        total_candidates = $eligible.Count
        next_offset = $(if (($offset + $windows.Count + $rejected.Count) -lt $eligible.Count) { $offset + $windows.Count + $rejected.Count } else { $null })
        authority_effect = $false
      })
      break
    }

    'VERIFY_TARGET' {
      $identity = Assert-TargetIdentity $request.target
      $rect = Get-WindowRectForIdentity $identity
      Write-Result ([ordered]@{
        ok = $true
        effect_started = $false
        schema = 'metaengine.windows-computer-executor.verify-target.v1'
        target = $identity
        rect = $rect
        authority_effect = $false
      })
      break
    }

    'OBSERVE_DISPLAYS' {
      $rows = @()
      $index = 0
      foreach ($screen in [System.Windows.Forms.Screen]::AllScreens) {
        $rows += [ordered]@{
          index = $index
          device_name = [string]$screen.DeviceName
          primary = [bool]$screen.Primary
          bounds = [ordered]@{
            x = [int]$screen.Bounds.X
            y = [int]$screen.Bounds.Y
            width = [int]$screen.Bounds.Width
            height = [int]$screen.Bounds.Height
          }
          working_area = [ordered]@{
            x = [int]$screen.WorkingArea.X
            y = [int]$screen.WorkingArea.Y
            width = [int]$screen.WorkingArea.Width
            height = [int]$screen.WorkingArea.Height
          }
        }
        $index += 1
      }
      Write-Result ([ordered]@{
        ok = $true
        effect_started = $false
        schema = 'metaengine.windows-computer-executor.displays.v1'
        displays = $rows
        count = $rows.Count
        authority_effect = $false
      })
      break
    }

    'FOREGROUND_STATUS' {
      $hwnd = [MetaengineWin32]::GetForegroundWindow()
      $foregroundProcessId = [UInt32]0
      $identity = $null
      if ($hwnd -ne [IntPtr]::Zero) {
        [MetaengineWin32]::GetWindowThreadProcessId($hwnd, [ref]$foregroundProcessId) | Out-Null
        if ($foregroundProcessId -gt 0) {
          try { $identity = Get-ProcessIdentity ([int]$foregroundProcessId) } catch {}
        }
      }
      Write-Result ([ordered]@{
        ok = $true
        effect_started = $false
        schema = 'metaengine.windows-computer-executor.foreground.v1'
        target = $identity
        authority_effect = $false
      })
      break
    }

    'UIA_SNAPSHOT' {
      $identity = Assert-TargetIdentity $request.target
      $root = Get-UiaRoot $identity
      $limit = [Math]::Max(1, [Math]::Min(1024, [int]$request.args.limit))
      $offset = [Math]::Max(0, [int]$request.args.offset)
      $allRows = @()
      $allRows += Project-Uia $root
      $all = $root.FindAll(
        [System.Windows.Automation.TreeScope]::Descendants,
        [System.Windows.Automation.Condition]::TrueCondition
      )
      foreach ($el in $all) {
        try { $allRows += Project-Uia $el } catch {}
      }
      $rows = @($allRows | Select-Object -Skip $offset -First $limit)
      Write-Result ([ordered]@{
        ok = $true
        effect_started = $false
        schema = 'metaengine.windows-computer-executor.uia-snapshot.v1'
        target = $identity
        elements = $rows
        count = $rows.Count
        offset = $offset
        total_elements = $allRows.Count
        next_offset = $(if (($offset + $rows.Count) -lt $allRows.Count) { $offset + $rows.Count } else { $null })
        truncated = ($allRows.Count -gt ($offset + $rows.Count))
        authority_effect = $false
      })
      break
    }

    'CAPTURE_DESKTOP' {
      $screens = @([System.Windows.Forms.Screen]::AllScreens)
      $monitor = [int]$request.args.monitor
      if ($monitor -lt 0 -or $monitor -ge $screens.Count) { throw "computer_monitor_not_found" }
      $screen = $screens[$monitor].Bounds
      $bitmap = New-Object System.Drawing.Bitmap $screen.Width, $screen.Height
      $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
      try {
        $graphics.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size)
        $dir = Join-Path ([System.IO.Path]::GetTempPath()) 'metaengine-computer-captures'
        [System.IO.Directory]::CreateDirectory($dir) | Out-Null
        $file = Join-Path $dir ("capture-" + [Guid]::NewGuid().ToString('N') + ".png")
        $bitmap.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)
      } finally {
        $graphics.Dispose()
        $bitmap.Dispose()
      }
      $hash = [MetaengineWin32]::GetFileSha256([string]$file)
      if (-not $hash) { throw "computer_capture_hash_unavailable" }
      Write-Result ([ordered]@{
        ok = $true
        effect_started = $false
        schema = 'metaengine.windows-computer-executor.capture.v1'
        monitor = $monitor
        origin = [ordered]@{ x=[int]$screen.X; y=[int]$screen.Y }
        width = [int]$screen.Width
        height = [int]$screen.Height
        png_path = $file
        png_sha256 = $hash
        machine_fingerprint_sha256 = Get-MachineFingerprint
        authority_effect = $false
      })
      break
    }

    'CAPTURE_WINDOW' {
      $identity = Assert-TargetIdentity $request.target
      $rect = Get-WindowRectForIdentity $identity
      if ($rect.width -le 0 -or $rect.height -le 0) { throw "computer_window_capture_bounds_invalid" }
      $hwnd = [IntPtr]([Convert]::ToInt64(([string]$identity.window_handle).Substring(2), 16))
      $foregroundBeforeCapture = ([MetaengineWin32]::GetForegroundWindow() -eq $hwnd)
      $bitmap = [System.Drawing.Bitmap]::new($rect.width,$rect.height,[System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
      $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
      try {
        $graphics.CopyFromScreen($rect.left, $rect.top, 0, 0, (New-Object System.Drawing.Size($rect.width, $rect.height)))
        $pixelHash = Get-BitmapPixelSha256 $bitmap
        $dir = Join-Path ([System.IO.Path]::GetTempPath()) 'metaengine-computer-captures'
        [System.IO.Directory]::CreateDirectory($dir) | Out-Null
        $file = Join-Path $dir ("window-" + [Guid]::NewGuid().ToString('N') + ".png")
        $bitmap.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)
      } finally {
        $graphics.Dispose()
        $bitmap.Dispose()
      }
      $hash = [MetaengineWin32]::GetFileSha256([string]$file)
      if (-not $hash) { throw "computer_capture_hash_unavailable" }
      $rectAfterCapture = Get-WindowRectForIdentity $identity
      $foregroundAfterCapture = ([MetaengineWin32]::GetForegroundWindow() -eq $hwnd)
      $geometryStable = (
        [int]$rectAfterCapture.left -eq [int]$rect.left -and
        [int]$rectAfterCapture.top -eq [int]$rect.top -and
        [int]$rectAfterCapture.width -eq [int]$rect.width -and
        [int]$rectAfterCapture.height -eq [int]$rect.height
      )
      $foregroundStable = ($foregroundBeforeCapture -and $foregroundAfterCapture)
      Write-Result ([ordered]@{
        ok = $true
        effect_started = $false
        schema = 'metaengine.windows-computer-executor.window-capture.v1'
        target = $identity
        rect = $rect
        foreground = $foregroundStable
        geometry_stable = $geometryStable
        png_path = $file
        png_sha256 = $hash
        pixel_sha256 = $pixelHash
        machine_fingerprint_sha256 = Get-MachineFingerprint
        authority_effect = $false
      })
      break
    }

    'UIA_FOCUS' {
      $identity = Assert-TargetIdentity $request.target
      $element = Find-UiaElement $identity @($request.args.runtime_id)
      $effectStarted = $true
      $element.SetFocus()
      $focused = [System.Windows.Automation.AutomationElement]::FocusedElement
      $proven = $false
      if ($focused) {
        try { $proven = RuntimeId-Equal $focused.GetRuntimeId() @($request.args.runtime_id) } catch {}
      }
      Write-Result ([ordered]@{
        ok = $proven
        effect_started = $true
        schema = 'metaengine.windows-computer-executor.effect.v1'
        readback_proven = $proven
        readback_kind = 'UIA_FOCUS_EXACT'
        action = 'UIA_FOCUS'
        target = Get-ProcessIdentity ([int]$identity.process_id)
        authority_effect = $proven
      })
      break
    }

    'UIA_INVOKE' {
      $identity = Assert-TargetIdentity $request.target
      $element = Find-UiaElement $identity @($request.args.runtime_id)
      $pattern = $element.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
      if (-not $pattern) { throw "computer_uia_invoke_pattern_unavailable" }
      $effectStarted = $true
      ([System.Windows.Automation.InvokePattern]$pattern).Invoke()
      Start-Sleep -Milliseconds 50
      $after = Get-ProcessIdentity ([int]$identity.process_id)
      Write-Result ([ordered]@{
        ok = $true
        effect_started = $true
        schema = 'metaengine.windows-computer-executor.effect.v1'
        readback_proven = $false
        readback_kind = 'DELIVERY_ONLY'
        dispatch_proven = $true
        action = 'UIA_INVOKE'
        target = $after
        authority_effect = $false
      })
      break
    }

    'UIA_SET_VALUE' {
      $identity = Assert-TargetIdentity $request.target
      $element = Find-UiaElement $identity @($request.args.runtime_id)
      $pattern = $element.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
      if (-not $pattern) { throw "computer_uia_value_pattern_unavailable" }
      $effectStarted = $true
      ([System.Windows.Automation.ValuePattern]$pattern).SetValue([string]$request.args.value)
      $afterPattern = [System.Windows.Automation.ValuePattern]$element.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
      $readback = ([string]$afterPattern.Current.Value -ceq [string]$request.args.value)
      Write-Result ([ordered]@{
        ok = $readback
        effect_started = $true
        schema = 'metaengine.windows-computer-executor.effect.v1'
        readback_proven = $readback
        readback_kind = 'UIA_VALUE_EXACT'
        action = 'UIA_SET_VALUE'
        target = Get-ProcessIdentity ([int]$identity.process_id)
        authority_effect = $readback
      })
      break
    }

    'UIA_TOGGLE' {
      $identity = Assert-TargetIdentity $request.target
      $element = Find-UiaElement $identity @($request.args.runtime_id)
      $pattern = [System.Windows.Automation.TogglePattern]$element.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
      if (-not $pattern) { throw "computer_uia_toggle_pattern_unavailable" }
      $before = $pattern.Current.ToggleState
      $effectStarted = $true
      $pattern.Toggle()
      $afterPattern = [System.Windows.Automation.TogglePattern]$element.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
      $after = $afterPattern.Current.ToggleState
      $readback = ($after -ne $before)
      Write-Result ([ordered]@{
        ok = $readback
        effect_started = $true
        schema = 'metaengine.windows-computer-executor.effect.v1'
        readback_proven = $readback
        readback_kind = 'UIA_TOGGLE_STATE_CHANGED'
        action = 'UIA_TOGGLE'
        toggle_state = [string]$after
        target = Get-ProcessIdentity ([int]$identity.process_id)
        authority_effect = $readback
      })
      break
    }

    'UIA_SELECT' {
      $identity = Assert-TargetIdentity $request.target
      $element = Find-UiaElement $identity @($request.args.runtime_id)
      $pattern = [System.Windows.Automation.SelectionItemPattern]$element.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
      if (-not $pattern) { throw "computer_uia_selection_pattern_unavailable" }
      $effectStarted = $true
      $pattern.Select()
      $afterPattern = [System.Windows.Automation.SelectionItemPattern]$element.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
      $readback = [bool]$afterPattern.Current.IsSelected
      Write-Result ([ordered]@{
        ok = $readback
        effect_started = $true
        schema = 'metaengine.windows-computer-executor.effect.v1'
        readback_proven = $readback
        readback_kind = 'UIA_SELECTION_EXACT'
        action = 'UIA_SELECT'
        target = Get-ProcessIdentity ([int]$identity.process_id)
        authority_effect = $readback
      })
      break
    }

    'UIA_EXPAND_COLLAPSE' {
      $identity = Assert-TargetIdentity $request.target
      $element = Find-UiaElement $identity @($request.args.runtime_id)
      $pattern = [System.Windows.Automation.ExpandCollapsePattern]$element.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern)
      if (-not $pattern) { throw "computer_uia_expand_pattern_unavailable" }
      $desired = ([string]$request.args.state).ToUpperInvariant()
      $effectStarted = $true
      if ($desired -eq 'EXPAND') { $pattern.Expand() } else { $pattern.Collapse() }
      $afterPattern = [System.Windows.Automation.ExpandCollapsePattern]$element.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern)
      $after = $afterPattern.Current.ExpandCollapseState
      $readback = (($desired -eq 'EXPAND' -and $after -eq [System.Windows.Automation.ExpandCollapseState]::Expanded) -or
                   ($desired -eq 'COLLAPSE' -and $after -eq [System.Windows.Automation.ExpandCollapseState]::Collapsed))
      Write-Result ([ordered]@{
        ok = $readback
        effect_started = $true
        schema = 'metaengine.windows-computer-executor.effect.v1'
        readback_proven = $readback
        readback_kind = 'UIA_EXPAND_STATE_EXACT'
        action = 'UIA_EXPAND_COLLAPSE'
        expand_state = [string]$after
        target = Get-ProcessIdentity ([int]$identity.process_id)
        authority_effect = $readback
      })
      break
    }

    'UIA_SCROLL' {
      $identity = Assert-TargetIdentity $request.target
      $element = Find-UiaElement $identity @($request.args.runtime_id)
      $pattern = [System.Windows.Automation.ScrollPattern]$element.GetCurrentPattern([System.Windows.Automation.ScrollPattern]::Pattern)
      if (-not $pattern) { throw "computer_uia_scroll_pattern_unavailable" }
      $beforeH = [double]$pattern.Current.HorizontalScrollPercent
      $beforeV = [double]$pattern.Current.VerticalScrollPercent
      $effectStarted = $true
      $pattern.Scroll((Resolve-ScrollAmount $request.args.horizontal),(Resolve-ScrollAmount $request.args.vertical))
      $afterPattern = [System.Windows.Automation.ScrollPattern]$element.GetCurrentPattern([System.Windows.Automation.ScrollPattern]::Pattern)
      $afterH = [double]$afterPattern.Current.HorizontalScrollPercent
      $afterV = [double]$afterPattern.Current.VerticalScrollPercent
      $readback = ($beforeH -ne $afterH -or $beforeV -ne $afterV)
      Write-Result ([ordered]@{
        ok = $readback
        effect_started = $true
        schema = 'metaengine.windows-computer-executor.effect.v1'
        readback_proven = $readback
        readback_kind = 'UIA_SCROLL_PERCENT_CHANGED'
        action = 'UIA_SCROLL'
        horizontal_scroll_percent = $afterH
        vertical_scroll_percent = $afterV
        target = Get-ProcessIdentity ([int]$identity.process_id)
        authority_effect = $readback
      })
      break
    }

    'TYPE_TEXT' {
      $identity = Assert-TargetIdentity $request.target
      $element = Find-UiaElement $identity @($request.args.runtime_id)
      $hwnd = [IntPtr]([Convert]::ToInt64(([string]$identity.window_handle).Substring(2), 16))
      $effectStarted = $true
      if (-not [MetaengineWin32]::SetForegroundWindow($hwnd)) { throw "computer_foreground_activation_failed" }
      Start-Sleep -Milliseconds 40
      if ([MetaengineWin32]::GetForegroundWindow() -ne $hwnd) { throw "computer_foreground_readback_failed" }
      $element.SetFocus()
      Start-Sleep -Milliseconds 20
      $focused = [System.Windows.Automation.AutomationElement]::FocusedElement
      $focusProven = $false
      if ($focused) {
        try { $focusProven = RuntimeId-Equal $focused.GetRuntimeId() @($request.args.runtime_id) } catch {}
      }
      if (-not $focusProven) { throw "computer_type_exact_focus_not_proven" }

      $valueReadbackAvailable = $false

      if (-not [MetaengineWin32]::SendCtrlA()) { throw "computer_type_replace_select_failed" }
      if (-not [MetaengineWin32]::SendUnicode([string]$request.args.text)) { throw "computer_unicode_input_failed" }
      Start-Sleep -Milliseconds 20

      $focusedAfter = [System.Windows.Automation.AutomationElement]::FocusedElement
      $focusAfterProven = $false
      if ($focusedAfter) {
        try { $focusAfterProven = RuntimeId-Equal $focusedAfter.GetRuntimeId() @($request.args.runtime_id) } catch {}
      }

      $afterValue = $null
      $readback = $false
      try {
        $afterPattern = [System.Windows.Automation.ValuePattern]$element.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
        if ($afterPattern) {
          $valueReadbackAvailable = $true
          $afterValue = [string]$afterPattern.Current.Value
          $expectedValue = [string]$request.args.text
          $readback = ($afterValue -ceq $expectedValue)
        }
      } catch {}

      $after = Get-ProcessIdentity ([int]$identity.process_id)
      Write-Result ([ordered]@{
        ok = $true
        effect_started = $true
        schema = 'metaengine.windows-computer-executor.effect.v1'
        readback_proven = $readback
        readback_kind = $(if ($readback) { 'UIA_VALUE_EXACT' } else { 'DELIVERY_ONLY' })
        dispatch_proven = $true
        action = 'TYPE_TEXT'
        exact_uia_focus = $focusAfterProven
        value_readback_available = $valueReadbackAvailable
        value_readback_proven = $readback
        target = $after
        authority_effect = $readback
      })
      break
    }

    'KEY_PRESS' {
      $identity = Assert-TargetIdentity $request.target
      $hwnd = [IntPtr]([Convert]::ToInt64(([string]$identity.window_handle).Substring(2), 16))
      $effectStarted = $true
      if (-not [MetaengineWin32]::SetForegroundWindow($hwnd)) { throw "computer_foreground_activation_failed" }
      Start-Sleep -Milliseconds 40
      if ([MetaengineWin32]::GetForegroundWindow() -ne $hwnd) { throw "computer_foreground_readback_failed" }
      $key = ([string]$request.args.key).ToUpperInvariant()
      $sent = $false
      if ($key -eq 'CTRL+A') {
        $sent = [MetaengineWin32]::SendCtrlA()
      } else {
        $map = @{
          'ENTER'=0x0D; 'ESCAPE'=0x1B; 'TAB'=0x09; 'BACKSPACE'=0x08; 'DELETE'=0x2E;
          'ARROWUP'=0x26; 'ARROWDOWN'=0x28; 'ARROWLEFT'=0x25; 'ARROWRIGHT'=0x27;
          'HOME'=0x24; 'END'=0x23; 'PAGEUP'=0x21; 'PAGEDOWN'=0x22
        }
        if (-not $map.ContainsKey($key)) { throw "computer_key_not_allowlisted" }
        $sent = [MetaengineWin32]::SendVirtualKey([UInt16]$map[$key])
      }
      if (-not $sent) { throw "computer_key_input_failed" }
      Write-Result ([ordered]@{
        ok = $true
        effect_started = $true
        schema = 'metaengine.windows-computer-executor.effect.v1'
        readback_proven = $false
        readback_kind = 'DELIVERY_ONLY'
        dispatch_proven = $true
        action = 'KEY_PRESS'
        target = Get-ProcessIdentity ([int]$identity.process_id)
        authority_effect = $false
      })
      break
    }

    'POINTER_CLICK' {
      $identity = Assert-TargetIdentity $request.target
      $rect = Get-WindowRectForIdentity $identity
      $x = [int]$request.args.x
      $y = [int]$request.args.y
      if ($x -lt 0 -or $y -lt 0 -or $x -ge $rect.width -or $y -ge $rect.height) {
        throw "computer_pointer_outside_exact_window"
      }
      $capturedRect = $request.args.visual_fence.window_rect
      if (-not $capturedRect) { throw "computer_visual_frame_geometry_required" }
      if ([int]$capturedRect.left -ne [int]$rect.left -or
          [int]$capturedRect.top -ne [int]$rect.top -or
          [int]$capturedRect.width -ne [int]$rect.width -or
          [int]$capturedRect.height -ne [int]$rect.height) {
        throw "computer_visual_frame_geometry_drift"
      }
      $screenX = $rect.left + $x
      $screenY = $rect.top + $y
      $hwnd = [IntPtr]([Convert]::ToInt64(([string]$identity.window_handle).Substring(2), 16))
      if ([MetaengineWin32]::GetForegroundWindow() -ne $hwnd) { throw "computer_visual_foreground_drift" }
      $null = Assert-PointTargetsWindow $screenX $screenY $hwnd "computer_visual_hit_test_target_mismatch"
      $effectStarted = $true
      if (-not [MetaengineWin32]::SetCursorPos($screenX, $screenY)) { throw "computer_pointer_position_failed" }

      $currentRect = Get-WindowRectForIdentity $identity
      if ([int]$capturedRect.left -ne [int]$currentRect.left -or
          [int]$capturedRect.top -ne [int]$currentRect.top -or
          [int]$capturedRect.width -ne [int]$currentRect.width -or
          [int]$capturedRect.height -ne [int]$currentRect.height) {
        throw "computer_visual_frame_geometry_drift_after_pointer_move"
      }
      $verifyBitmap = [System.Drawing.Bitmap]::new($currentRect.width,$currentRect.height,[System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
      $verifyGraphics = [System.Drawing.Graphics]::FromImage($verifyBitmap)
      try {
        $verifyGraphics.CopyFromScreen($currentRect.left,$currentRect.top,0,0,(New-Object System.Drawing.Size($currentRect.width,$currentRect.height)))
        $currentPixelSha256 = Get-BitmapPixelSha256 $verifyBitmap
      } finally {
        $verifyGraphics.Dispose()
        $verifyBitmap.Dispose()
      }
      if ([string]$currentPixelSha256 -ne [string]$request.args.visual_fence.pixel_sha256) {
        throw "computer_visual_frame_changed_before_click"
      }
      $null = Assert-TargetIdentity $request.target
      if ([MetaengineWin32]::GetForegroundWindow() -ne $hwnd) {
        throw "computer_visual_foreground_drift_before_click"
      }
      $null = Assert-PointTargetsWindow $screenX $screenY $hwnd "computer_visual_hit_test_drift_before_click"

      [MetaengineWin32]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
      [MetaengineWin32]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
      $point = New-Object MetaengineWin32+POINT
      [MetaengineWin32]::GetCursorPos([ref]$point) | Out-Null
      $proven = ($point.X -eq $screenX -and $point.Y -eq $screenY -and [MetaengineWin32]::GetForegroundWindow() -eq $hwnd)
      Write-Result ([ordered]@{
        ok = $proven
        effect_started = $true
        schema = 'metaengine.windows-computer-executor.effect.v1'
        readback_proven = $false
        readback_kind = 'DELIVERY_ONLY'
        dispatch_proven = $proven
        action = 'POINTER_CLICK'
        cursor = [ordered]@{ x=$point.X; y=$point.Y }
        target = Get-ProcessIdentity ([int]$identity.process_id)
        authority_effect = $false
      })
      break
    }

    default { throw "computer_action_not_allowlisted" }
  }
  Write-BridgePhase 'ACTION_END'
} catch {
  Write-Result ([ordered]@{
    ok = $false
    effect_started = [bool]$effectStarted
    schema = 'metaengine.windows-computer-executor.error.v1'
    error = [string]$_.Exception.Message
    authority_effect = $false
  })
}
`;

export const WINDOWS_COMPUTER_BRIDGE_SHA256 = createHash('sha256')
  .update(POWERSHELL_BRIDGE, 'utf8')
  .digest('hex');

function parseSingleJson(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) throw new Error('computer_executor_empty_response');
  const lines = trimmed.split(/\r?\n/).filter(Boolean);
  const row = JSON.parse(lines.at(-1));
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('computer_executor_response_invalid');
  return row;
}

const CAPTURE_LEASE_MS = 60000;
const CAPTURE_LEASE_SCHEMA = 'metaengine.windows-computer-capture-lease.v1';
const captureName = /^(?:window|capture)-[a-f0-9]{32}\.png$/;
const activeCaptures = new Map();
let captureRootReady = null;
const samePhysical = (a,b) => a.dev===b.dev && a.ino===b.ino && a.birthtimeMs===b.birthtimeMs;

async function assertCaptureRoot(root, expected = null) {
  const info=await fs.lstat(root);
  if(!info.isDirectory()||info.isSymbolicLink()||await fs.realpath(root)!==root
    ||(expected&&!samePhysical(info,expected)))throw Error('computer_capture_store_changed');
  return info;
}

async function deleteCaptureLease(root,marker,{expiredOnly=true,rootIdentity=null}={}) {
  if(!captureName.test(marker.slice(0,-11))||!marker.endsWith('.lease.json'))return false;
  await assertCaptureRoot(root,rootIdentity);
  const markerPath=path.join(root,marker), before=await fs.lstat(markerPath).catch(()=>null);
  if(!before?.isFile()||before.isSymbolicLink()||before.nlink!==1||before.size>2048)return false;
  let lease;try{lease=JSON.parse(await fs.readFile(markerPath,'utf8'));}catch{return false;}
  if(!lease||typeof lease!=='object'||Array.isArray(lease))return false;
  const created=Date.parse(lease.created_at),expires=Date.parse(lease.expires_at);
  if(lease.schema!==CAPTURE_LEASE_SCHEMA||lease.filename!==marker.slice(0,-11)
    ||!captureName.test(lease.filename)||!Number.isFinite(created)||expires-created!==CAPTURE_LEASE_MS
    ||(expiredOnly&&expires>Date.now())||!/^[a-f0-9]{64}$/.test(lease.sha256||''))return false;
  const after=await fs.lstat(markerPath).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  if(!after||!samePhysical(before,after)||before.size!==after.size||before.mtimeMs!==after.mtimeMs)return false;
  const imagePath=path.join(root,lease.filename), image=await fs.lstat(imagePath).catch(()=>null);
  if(image){
    if(!image.isFile()||image.isSymbolicLink()||image.nlink!==1||image.size<16||image.size>8*1024*1024)return false;
    const content=await fs.readFile(imagePath),readback=await fs.lstat(imagePath).catch(()=>null);
    if(!readback||!samePhysical(image,readback)||image.size!==readback.size||image.mtimeMs!==readback.mtimeMs
      ||content.length!==image.size||createHash('sha256').update(content).digest('hex')!==lease.sha256)return false;
  }
  await assertCaptureRoot(root,rootIdentity);
  const unlinkOwned=filename=>fs.unlink(filename).catch(error=>{if(error.code!=='ENOENT')throw error;});
  if(image)await unlinkOwned(imagePath);
  await unlinkOwned(markerPath);
  const active=activeCaptures.get(markerPath);if(active)clearTimeout(active.timer);
  activeCaptures.delete(markerPath);return true;
}

async function captureStore() {
  if(!captureRootReady)captureRootReady=(async()=>{
    const temporary=await fs.realpath(os.tmpdir()),root=path.join(temporary,'metaengine-computer-captures');
    await fs.mkdir(root,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});
    const identity=await assertCaptureRoot(root);
    const storage=await protectOwnerOnlyWindowsDirectory(root);
    if(storage.owner_dacl_verified!==true)throw Error('computer_capture_store_unsealed');
    await assertCaptureRoot(root,identity);
    // This dedicated sealed store is the only startup cleanup scope. Never scan
    // general TEMP, per-request helpers, or images without an owned lease marker.
    const entries=await fs.opendir(root);let examined=0;
    for await(const entry of entries){
      if(++examined>256)break;
      if(entry.isFile()&&entry.name.endsWith('.lease.json'))await deleteCaptureLease(root,entry.name,{rootIdentity:identity});
    }
    return {root,identity};
  })().catch(error=>{captureRootReady=null;throw error;});
  const store=await captureRootReady;await assertCaptureRoot(store.root,store.identity);return store;
}

export async function retireExpiredWindowsComputerCaptures() {
  const {root,identity}=await captureStore();
  let examined=0,removed=0;
  for await(const entry of await fs.opendir(root)){
    if(++examined>256)break;
    if(entry.isFile()&&entry.name.endsWith('.lease.json')
      &&await deleteCaptureLease(root,entry.name,{rootIdentity:identity}))removed++;
  }
  return Object.freeze({removed,authority_effect:false});
}

async function publishCaptureLease(result,requestDirectory) {
  if(activeCaptures.size>=64)throw Error('computer_capture_store_capacity_wait');
  const sourceRoot=path.join(await fs.realpath(requestDirectory),'metaengine-computer-captures');
  const filename=path.basename(result.png_path||'');
  if(!captureName.test(filename)||path.dirname(await fs.realpath(result.png_path))!==sourceRoot
    ||(await fs.lstat(sourceRoot)).isSymbolicLink())throw Error('computer_capture_source_boundary');
  const before=await fs.lstat(result.png_path);
  if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||before.size<16||before.size>8*1024*1024)
    throw Error('computer_capture_source_invalid');
  const bytes=await fs.readFile(result.png_path),after=await fs.lstat(result.png_path);
  if(!samePhysical(before,after)||before.size!==after.size||before.mtimeMs!==after.mtimeMs||bytes.length!==before.size
    ||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||createHash('sha256').update(bytes).digest('hex')!==result.png_sha256)
    throw Error('computer_capture_source_changed');
  const {root,identity}=await captureStore();
  const outputName=(filename.startsWith('window-')?'window-':'capture-')+randomUUID().replaceAll('-','')+'.png';
  const imagePath=path.join(root,outputName),marker=outputName+'.lease.json',markerPath=path.join(root,marker);
  const created=Date.now(),lease={schema:CAPTURE_LEASE_SCHEMA,filename:outputName,sha256:result.png_sha256,
    created_at:new Date(created).toISOString(),expires_at:new Date(created+CAPTURE_LEASE_MS).toISOString()};
  // Persist cleanup ownership first so a crash during image publication leaves
  // an expiring owned artifact, never a permanent untracked screenshot.
  const markerHandle=await fs.open(markerPath,'wx',0o600);
  try{await markerHandle.writeFile(JSON.stringify(lease));await markerHandle.sync();}finally{await markerHandle.close();}
  try{
    const output=await fs.open(imagePath,'wx',0o600);
    try{await output.writeFile(bytes);await output.sync();}finally{await output.close();}
    await assertCaptureRoot(root,identity);
    const imageIdentity=await fs.lstat(imagePath),markerIdentity=await fs.lstat(markerPath);
    const timer=setTimeout(()=>{void deleteCaptureLease(root,marker,{expiredOnly:false,rootIdentity:identity}).catch(()=>{});},CAPTURE_LEASE_MS);
    timer.unref();activeCaptures.set(markerPath,{root,identity,imagePath,imageIdentity,markerPath,markerIdentity,timer});
    return {...result,png_path:imagePath,capture_expires_at:lease.expires_at};
  }catch(error){await deleteCaptureLease(root,marker,{expiredOnly:false,rootIdentity:identity}).catch(()=>{});throw error;}
}

// Normal owner shutdown removes only the exact files this process published.
// After a crash, the next capture startup removes expired owned lease pairs.
process.once('exit',()=>{
  for(const item of activeCaptures.values())try{
    if(realpathSync(item.root)!==item.root||!samePhysical(lstatSync(item.root),item.identity))continue;
    for(const [file,identity]of[[item.imagePath,item.imageIdentity],[item.markerPath,item.markerIdentity]]){
      try{const current=lstatSync(file);if(current.isFile()&&!current.isSymbolicLink()&&current.nlink===1&&samePhysical(current,identity))unlinkSync(file);}catch{}
    }
  }catch{}
});

// Only the OS installation supplies the interpreter and its modules. Caller
// PATH, PowerShell profiles and unrelated application credentials never select
// or configure this process. The private temporary directory is its sole temp.
export function windowsComputerProcessPlan(temporaryDirectory, source = process.env) {
  const root = String(source.SystemRoot || source.SYSTEMROOT || '');
  if (!/^[A-Za-z]:\\Windows$/i.test(root) || !path.win32.isAbsolute(temporaryDirectory || '')
      || /^(?:\\\\|\/\/)/.test(temporaryDirectory)) throw new Error('computer_executor_windows_root_unverified');
  const system32 = path.win32.join(root, 'System32');
  const powershell = path.win32.join(system32, 'WindowsPowerShell', 'v1.0');
  return Object.freeze({ executable:path.win32.join(powershell, 'powershell.exe'), env:Object.freeze({
    SystemRoot:root, SYSTEMROOT:root, WINDIR:root, SystemDrive:path.win32.parse(root).root.slice(0,2),
    PATH:[system32,root,powershell].join(';'), PATHEXT:'.COM;.EXE;.BAT;.CMD',
    COMSPEC:path.win32.join(system32,'cmd.exe'), PSModulePath:path.win32.join(powershell,'Modules'),
    TEMP:temporaryDirectory,TMP:temporaryDirectory,USERPROFILE:temporaryDirectory,
  }) });
}

async function verifyWindowsComputerInterpreter(executable) {
  let current = path.parse(executable).root;
  for (const part of path.relative(current, executable).split(path.sep)) {
    current = path.join(current, part);
    if ((await fs.lstat(current)).isSymbolicLink()) throw new Error('computer_executor_interpreter_alias');
  }
  if (path.resolve(await fs.realpath(executable)).toLowerCase() !== path.resolve(executable).toLowerCase()
      || !(await fs.lstat(executable)).isFile()) throw new Error('computer_executor_interpreter_unverified');
}

export async function runFixedWindowsPowerShell(request, {
  timeout_ms = DEFAULT_TIMEOUT_MS,
  spawn_impl = spawn,
  on_native_phase = null,
} = {}) {
  if (process.platform !== 'win32') throw new Error('computer_executor_windows_required');
  const timeoutMs = Math.max(1000, Math.min(60000, Number(timeout_ms) || DEFAULT_TIMEOUT_MS));
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-computer-'));
  const cleanupRoot = path.resolve(os.tmpdir());
  const cleanupRelative = path.relative(cleanupRoot, path.resolve(dir));
  if (!cleanupRelative || cleanupRelative.startsWith('..') || path.isAbsolute(cleanupRelative)
      || path.dirname(path.resolve(dir)) !== cleanupRoot) throw new Error('computer_executor_temporary_boundary');
  let helperClosePending = false;
  try {
  const plan = windowsComputerProcessPlan(dir);
  await verifyWindowsComputerInterpreter(plan.executable);
  const storage = await protectOwnerOnlyWindowsDirectory(dir);
  if (storage?.owner_dacl_verified !== true) throw new Error('computer_executor_private_storage_unverified');
  const requestPath = path.join(dir, `request-${randomUUID()}.json`);
  const bridgePath = path.join(dir, `bridge-${WINDOWS_COMPUTER_BRIDGE_SHA256}.ps1`);
  await fs.writeFile(requestPath, JSON.stringify(request), { encoding:'utf8', flag:'wx', mode:0o600 });
  await fs.writeFile(bridgePath, POWERSHELL_BRIDGE, { encoding:'utf8', flag:'wx', mode:0o600 });
  const bridgeBytes = await fs.readFile(bridgePath);
  const bridgeReadbackSha256 = createHash('sha256').update(bridgeBytes).digest('hex');
  if (bridgeReadbackSha256 !== WINDOWS_COMPUTER_BRIDGE_SHA256) {
    throw new Error('computer_executor_bridge_write_readback_mismatch');
  }

    const result = await new Promise((resolve, reject) => {
      const child = spawn_impl(
        plan.executable,
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', bridgePath],
        {
          windowsHide: true,
          shell: false,
          cwd: dir,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: {
            ...plan.env,
            METAENGINE_COMPUTER_REQUEST_PATH: requestPath,
          },
        },
      );

      helperClosePending = true;
      let stdout = '';
      let phaseLine = '', phaseDiscard = false, phaseBytes = 0, phaseIndex = -1;
      let failure = null, closeTimer = null;
      let settled = false;
      const diagnosticError = message => Object.assign(new Error(message), {
        native_phase: BRIDGE_PHASES[phaseIndex] || 'NOT_STARTED',
      });
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearTimeout(closeTimer);
        fn(value);
      };
      const stop = error => {
        if (settled || failure) return;
        failure = error;
        // A kill request is not close evidence. Keep the protected files until
        // the exact helper closes; if that cannot be confirmed, retain them.
        closeTimer = setTimeout(() => finish(reject, Object.assign(failure, {helper_close_confirmed:false})), 5000);
        try { child.kill(); } catch {}
      };
      const timer = setTimeout(() => stop(diagnosticError(`computer_executor_timeout:${request.action}`)), timeoutMs);

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        if (failure || settled) return;
        stdout += chunk;
        if (Buffer.byteLength(stdout, 'utf8') > MAX_STDOUT_BYTES) {
          stop(diagnosticError('computer_executor_stdout_limit'));
        }
      });
      child.stderr.on('data', (chunk) => {
        // Only fixed, ordered labels can leave the diagnostic channel. Native
        // errors, request contents, paths and environment are never callbacks.
        for (const character of chunk) {
          if (++phaseBytes > 4096) break;
          if (character === '\n') {
            const line = phaseLine.replace(/\r$/, '');
            const candidate = line.startsWith('ME_PC_BRIDGE_V1 ') ? BRIDGE_PHASES.indexOf(line.slice(16)) : -1;
            if (!phaseDiscard && candidate > phaseIndex) {
              phaseIndex = candidate;
              if (typeof on_native_phase === 'function') {
                try { on_native_phase(BRIDGE_PHASES[phaseIndex]); } catch { /* Diagnostics never decide an effect. */ }
              }
            }
            phaseLine = ''; phaseDiscard = false;
          } else if (phaseLine.length < 96 && !phaseDiscard) phaseLine += character;
          else { phaseLine = ''; phaseDiscard = true; }
        }
      });
      child.once('error', () => stop(diagnosticError('computer_executor_spawn_failed')));
      child.once('close', (code, signal) => {
        helperClosePending = false;
        if (settled) return;
        if (failure) { finish(reject, Object.assign(failure, {helper_close_confirmed:true})); return; }
        if (code !== 0 || signal) {
          finish(reject, diagnosticError(`computer_executor_exit_${code}`));
          return;
        }
        try {
          finish(resolve, parseSingleJson(stdout));
        } catch {
          const reason = stdout.trim() ? 'computer_executor_response_invalid' : 'computer_executor_empty_response';
          finish(reject, diagnosticError(reason));
        }
      });
    });
    if(result.ok===true&&['CAPTURE_DESKTOP','CAPTURE_WINDOW'].includes(request.action))return await publishCaptureLease(result,dir);
    return result;
  } finally {
    if (!helperClosePending) await fs.rm(dir, { recursive:true, force:true }).catch(() => {});
  }
}

export class WindowsLocalComputerExecutor {
  #platform;
  #runner;
  #clock;
  #visualFrames = new Map();

  constructor({
    platform = process.platform,
    runner = runFixedWindowsPowerShell,
    clock = Date.now,
  } = {}) {
    this.#platform = String(platform);
    if (typeof runner !== 'function') throw new Error('computer_executor_runner_required');
    if (typeof clock !== 'function') throw new Error('computer_executor_clock_required');
    this.#runner = runner;
    this.#clock = clock;
  }

  #rememberVisualFrame(request, result) {
    const hash = String(result?.png_sha256 || '').toLowerCase();
    const machine = String(result?.machine_fingerprint_sha256 || '').toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(hash) || !/^[0-9a-f]{64}$/.test(machine)) return false;
    const targetIdentitySha256 = request?.action === 'CAPTURE_WINDOW'
      ? String(request?.target_identity_sha256 || '').toLowerCase()
      : null;
    if (request?.action === 'CAPTURE_WINDOW' && !/^[0-9a-f]{64}$/.test(targetIdentitySha256 || '')) return false;
    const rect = request?.action === 'CAPTURE_WINDOW' && result?.rect && typeof result.rect === 'object'
      ? Object.freeze({
          left:Number(result.rect.left),
          top:Number(result.rect.top),
          width:Number(result.rect.width),
          height:Number(result.rect.height),
        })
      : null;
    if (request?.action === 'CAPTURE_WINDOW' && (
      !rect
      || ![rect.left,rect.top,rect.width,rect.height].every(Number.isSafeInteger)
      || rect.width <= 0
      || rect.height <= 0
    )) return false;
    const pixelSha256 = request?.action === 'CAPTURE_WINDOW'
      ? String(result?.pixel_sha256 || '').toLowerCase()
      : null;
    if (request?.action === 'CAPTURE_WINDOW' && !/^[0-9a-f]{64}$/.test(pixelSha256 || '')) return false;
    const now = Number(this.#clock());
    this.#visualFrames.set(hash, Object.freeze({
      observed_ms: now,
      machine_fingerprint_sha256: machine,
      target_identity_sha256: targetIdentitySha256,
      window_rect: rect,
      pixel_sha256: pixelSha256,
      foreground_at_capture: request?.action === 'CAPTURE_WINDOW' ? result?.foreground === true : false,
      geometry_stable_at_capture: request?.action === 'CAPTURE_WINDOW' ? result?.geometry_stable === true : false,
    }));
    for (const [key, row] of this.#visualFrames) {
      if (now - Number(row.observed_ms || 0) > 10000) this.#visualFrames.delete(key);
    }
    while (this.#visualFrames.size > 16) this.#visualFrames.delete(this.#visualFrames.keys().next().value);
    return true;
  }

  #consumeVisualFence(request) {
    if (request?.action !== 'POINTER_CLICK') return { ok:true };
    const hash = String(request?.args?.visual_fence?.frame_sha256 || '').toLowerCase();
    const frame = this.#visualFrames.get(hash);
    if (!frame) return { ok:false, reason:'computer_visual_frame_not_observed' };
    const age = Number(this.#clock()) - Number(frame.observed_ms || 0);
    if (!Number.isFinite(age) || age < 0 || age > Number(request.args.visual_fence.max_age_ms || 3000)) {
      this.#visualFrames.delete(hash);
      return { ok:false, reason:'computer_visual_frame_stale' };
    }
    if (frame.machine_fingerprint_sha256 !== request.target?.machine_fingerprint_sha256) {
      this.#visualFrames.delete(hash);
      return { ok:false, reason:'computer_visual_frame_machine_mismatch' };
    }
    if (!frame.target_identity_sha256) {
      this.#visualFrames.delete(hash);
      return { ok:false, reason:'computer_visual_frame_target_unbound' };
    }
    if (frame.target_identity_sha256 !== request.target_identity_sha256) {
      this.#visualFrames.delete(hash);
      return { ok:false, reason:'computer_visual_frame_target_mismatch' };
    }
    if (!frame.window_rect) {
      this.#visualFrames.delete(hash);
      return { ok:false, reason:'computer_visual_frame_geometry_unbound' };
    }
    if (!frame.foreground_at_capture) {
      this.#visualFrames.delete(hash);
      return { ok:false, reason:'computer_visual_frame_not_foreground_at_capture' };
    }
    if (!frame.geometry_stable_at_capture) {
      this.#visualFrames.delete(hash);
      return { ok:false, reason:'computer_visual_frame_geometry_unstable_at_capture' };
    }
    if (!/^[0-9a-f]{64}$/.test(String(frame.pixel_sha256 || ''))) {
      this.#visualFrames.delete(hash);
      return { ok:false, reason:'computer_visual_frame_pixel_digest_unbound' };
    }
    this.#visualFrames.delete(hash);
    return { ok:true, frame };
  }

  snapshot() {
    return Object.freeze({
      schema: 'metaengine.windows-local-computer-executor.v1',
      version: '2.0.0',
      platform: this.#platform,
      available: this.#platform === 'win32',
      bridge_sha256: WINDOWS_COMPUTER_BRIDGE_SHA256,
      plane: computerAuthorityPlaneSnapshot(),
      executor_process_model: 'BOUNDED_FIXED_POWERSHELL_BRIDGE',
      bridge_transport: 'HASH_VERIFIED_TEMP_SCRIPT',
      raw_shell_input: false,
      arbitrary_eval: false,
      automatic_retry_allowed: false,
      scheduler_authority: false,
      authority_effect: false,
    });
  }

  async status() {
    if (this.#platform !== 'win32') return this.snapshot();
    const request = normalizeComputerRequest({ action:'STATUS' });
    const result = await this.#runner(request);
    return Object.freeze({ ...this.snapshot(), runtime: result });
  }

  async observe(input = {}) {
    if (this.#platform !== 'win32') throw new Error('computer_executor_windows_required');
    const request = normalizeComputerRequest(input);
    if (request.mutating) throw new Error('computer_observe_mutation_forbidden');
    const result = await this.#runner(request);
    if (result?.ok !== true) throw new Error(String(result?.error || 'computer_observe_failed'));
    if (['CAPTURE_DESKTOP','CAPTURE_WINDOW'].includes(request.action)) this.#rememberVisualFrame(request, result);
    let projected = result;
    if (request.action === 'OBSERVE_WINDOWS' && Array.isArray(result?.windows)) {
      projected = {
        ...result,
        windows: result.windows.map((row) => ({
          ...row,
          target_identity_sha256: row?.identity ? computerTargetIdentityDigest(row.identity) : null,
        })),
      };
    } else if (['UIA_SNAPSHOT','CAPTURE_WINDOW','VERIFY_TARGET','FOREGROUND_STATUS'].includes(request.action) && result?.target) {
      projected = {
        ...result,
        target_identity_sha256: computerTargetIdentityDigest(result.target),
      };
    }
    return Object.freeze({
      schema: 'metaengine.computer-observation.v1',
      request,
      result: projected,
      authority_effect: false,
    });
  }

  async act(input = {}, context = {}) {
    if (this.#platform !== 'win32') throw new Error('computer_executor_windows_required');
    const request = normalizeComputerRequest(input, context);
    if (!request.mutating) throw new Error('computer_act_read_only_forbidden');

    const visualFence = this.#consumeVisualFence(request);
    if (!visualFence.ok) {
      return projectComputerEffectReceipt({
        request,
        result: {
          schema: 'metaengine.windows-computer-executor.pre-effect.v1',
          action: request.action,
          ok: false,
          effect_started: false,
          authority_effect: false,
        },
        outcome: 'NO_EFFECT_PROVEN',
        error: visualFence.reason,
      });
    }

    let dispatchRequest = request;
    if (request.action === 'POINTER_CLICK') {
      dispatchRequest = Object.freeze({
        ...request,
        args:Object.freeze({
          ...request.args,
          visual_fence:Object.freeze({
            ...request.args.visual_fence,
            window_rect:visualFence.frame.window_rect,
            pixel_sha256:visualFence.frame.pixel_sha256,
            foreground_at_capture:true,
            geometry_stable_at_capture:true,
          }),
        }),
      });
    }

    // Any physical effect can invalidate a previous screen observation.
    this.#visualFrames.clear();

    let result;
    try {
      result = await this.#runner(dispatchRequest);
    } catch (error) {
      return projectComputerEffectReceipt({
        request,
        outcome: 'AMBIGUOUS_NO_RETRY',
        error: String(error?.message || error),
      });
    }

    if (hasAdmissibleEffectReadback(request, result)) {
      return projectComputerEffectReceipt({
        request,
        result,
        outcome: 'EFFECT_PROVEN',
      });
    }

    if (result?.effect_started !== false) {
      return projectComputerEffectReceipt({
        request,
        result,
        outcome: 'AMBIGUOUS_NO_RETRY',
        error: result?.error || (result?.effect_started === true
          ? 'computer_effect_readback_not_proven'
          : 'computer_effect_start_unconfirmed'),
      });
    }

    return projectComputerEffectReceipt({
      request,
      result,
      outcome: 'NO_EFFECT_PROVEN',
      error: result?.error || 'computer_effect_pre_actuation_abort',
    });
  }
}

export function createWindowsLocalComputerExecutor(options) {
  return new WindowsLocalComputerExecutor(options);
}
