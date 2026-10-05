import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  computerAuthorityPlaneSnapshot,
  computerTargetIdentityDigest,
  normalizeComputerRequest,
  projectComputerEffectReceipt,
} from './computer-authority-plane.mjs';

const MAX_STDOUT_BYTES = 8 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15000;

const POWERSHELL_BRIDGE = String.raw\`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

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

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

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
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT point);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
  [DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint count, INPUT[] inputs, int size);

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
  try {
    if ($p.Path) { $exeHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $p.Path).Hash.ToLowerInvariant() }
  } catch {}
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
  try { $runtime = @($Element.GetRuntimeId()) } catch {}
  return [ordered]@{
    runtime_id = $runtime
    name = [string]$Element.Current.Name
    automation_id = [string]$Element.Current.AutomationId
    control_type = [string]$Element.Current.ControlType.ProgrammaticName
    class_name = [string]$Element.Current.ClassName
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

$requestPath = [string]$env:METAENGINE_COMPUTER_REQUEST_PATH
if (-not $requestPath) { throw "computer_request_path_missing" }
$request = Get-Content -Raw -LiteralPath $requestPath | ConvertFrom-Json
$effectStarted = $false

try {
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
        } catch {}
      }
      Write-Result ([ordered]@{
        ok = $true
        effect_started = $false
        schema = 'metaengine.windows-computer-executor.windows.v1'
        windows = $windows
        count = $windows.Count
        offset = $offset
        total_candidates = $eligible.Count
        next_offset = $(if (($offset + $windows.Count) -lt $eligible.Count) { $offset + $windows.Count } else { $null })
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
      $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
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
      $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $file).Hash.ToLowerInvariant()
      Write-Result ([ordered]@{
        ok = $true
        effect_started = $false
        schema = 'metaengine.windows-computer-executor.capture.v1'
        monitor = 0
        width = [int]$screen.Width
        height = [int]$screen.Height
        png_path = $file
        png_sha256 = $hash
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
        action = 'UIA_FOCUS'
        target = Get-ProcessIdentity ([int]$identity.process_id)
        authority_effect = $proven
      })
      break
    }

    'UIA_INVOKE' {
      $identity = Assert-TargetIdentity $request.target
      $element = Find-UiaElement $identity @($request.args.runtime_id)
      $effectStarted = $true
      $pattern = $element.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
      if (-not $pattern) { throw "computer_uia_invoke_pattern_unavailable" }
      ([System.Windows.Automation.InvokePattern]$pattern).Invoke()
      Start-Sleep -Milliseconds 50
      $after = Get-ProcessIdentity ([int]$identity.process_id)
      Write-Result ([ordered]@{
        ok = $true
        effect_started = $true
        schema = 'metaengine.windows-computer-executor.effect.v1'
        readback_proven = $true
        action = 'UIA_INVOKE'
        target = $after
        authority_effect = $true
      })
      break
    }

    'TYPE_TEXT' {
      $identity = Assert-TargetIdentity $request.target
      $element = Find-UiaElement $identity @($request.args.runtime_id)
      $hwnd = [IntPtr]([Convert]::ToInt64(([string]$identity.window_handle).Substring(2), 16))
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
      $effectStarted = $true
      if (-not [MetaengineWin32]::SendCtrlA()) { throw "computer_type_replace_select_failed" }
      if (-not [MetaengineWin32]::SendUnicode([string]$request.args.text)) { throw "computer_unicode_input_failed" }
      $focusedAfter = [System.Windows.Automation.AutomationElement]::FocusedElement
      $readback = $false
      if ($focusedAfter) {
        try { $readback = RuntimeId-Equal $focusedAfter.GetRuntimeId() @($request.args.runtime_id) } catch {}
      }
      $after = Get-ProcessIdentity ([int]$identity.process_id)
      Write-Result ([ordered]@{
        ok = $readback
        effect_started = $true
        schema = 'metaengine.windows-computer-executor.effect.v1'
        readback_proven = $readback
        action = 'TYPE_TEXT'
        exact_uia_focus = $readback
        target = $after
        authority_effect = $readback
      })
      break
    }

    'KEY_PRESS' {
      $identity = Assert-TargetIdentity $request.target
      $hwnd = [IntPtr]([Convert]::ToInt64(([string]$identity.window_handle).Substring(2), 16))
      if (-not [MetaengineWin32]::SetForegroundWindow($hwnd)) { throw "computer_foreground_activation_failed" }
      Start-Sleep -Milliseconds 40
      if ([MetaengineWin32]::GetForegroundWindow() -ne $hwnd) { throw "computer_foreground_readback_failed" }
      $key = ([string]$request.args.key).ToUpperInvariant()
      $effectStarted = $true
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
        readback_proven = $true
        action = 'KEY_PRESS'
        target = Get-ProcessIdentity ([int]$identity.process_id)
        authority_effect = $true
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
      $screenX = $rect.left + $x
      $screenY = $rect.top + $y
      $hwnd = [IntPtr]([Convert]::ToInt64(([string]$identity.window_handle).Substring(2), 16))
      if (-not [MetaengineWin32]::SetForegroundWindow($hwnd)) { throw "computer_foreground_activation_failed" }
      Start-Sleep -Milliseconds 40
      if ([MetaengineWin32]::GetForegroundWindow() -ne $hwnd) { throw "computer_foreground_readback_failed" }
      if (-not [MetaengineWin32]::SetCursorPos($screenX, $screenY)) { throw "computer_pointer_position_failed" }
      $effectStarted = $true
      [MetaengineWin32]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
      [MetaengineWin32]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
      $point = New-Object MetaengineWin32+POINT
      [MetaengineWin32]::GetCursorPos([ref]$point) | Out-Null
      $proven = ($point.X -eq $screenX -and $point.Y -eq $screenY -and [MetaengineWin32]::GetForegroundWindow() -eq $hwnd)
      Write-Result ([ordered]@{
        ok = $proven
        effect_started = $true
        schema = 'metaengine.windows-computer-executor.effect.v1'
        readback_proven = $proven
        action = 'POINTER_CLICK'
        cursor = [ordered]@{ x=$point.X; y=$point.Y }
        target = Get-ProcessIdentity ([int]$identity.process_id)
        authority_effect = $proven
      })
      break
    }

    default { throw "computer_action_not_allowlisted" }
  }
} catch {
  Write-Result ([ordered]@{
    ok = $false
    effect_started = [bool]$effectStarted
    schema = 'metaengine.windows-computer-executor.error.v1'
    error = [string]$_.Exception.Message
    authority_effect = $false
  })
}
\`;

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

export async function runFixedWindowsPowerShell(request, {
  timeout_ms = DEFAULT_TIMEOUT_MS,
  spawn_impl = spawn,
} = {}) {
  if (process.platform !== 'win32') throw new Error('computer_executor_windows_required');
  const timeoutMs = Math.max(1000, Math.min(60000, Number(timeout_ms) || DEFAULT_TIMEOUT_MS));
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-computer-'));
  const requestPath = path.join(dir, \`request-\${randomUUID()}.json\`);
  await fs.writeFile(requestPath, JSON.stringify(request), { encoding:'utf8', flag:'wx', mode:0o600 });

  try {
    return await new Promise((resolve, reject) => {
      const child = spawn_impl(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '-'],
        {
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: {
            ...process.env,
            METAENGINE_COMPUTER_REQUEST_PATH: requestPath,
          },
        },
      );

      let stdout = '';
      let stderr = '';
      let settled = false;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn(value);
      };
      const timer = setTimeout(() => {
        try { child.kill(); } catch {}
        finish(reject, new Error('computer_executor_timeout'));
      }, timeoutMs);

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
        if (Buffer.byteLength(stdout, 'utf8') > MAX_STDOUT_BYTES) {
          try { child.kill(); } catch {}
          finish(reject, new Error('computer_executor_stdout_limit'));
        }
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
        if (stderr.length > 8192) stderr = stderr.slice(-8192);
      });
      child.once('error', (error) => finish(reject, error));
      child.once('exit', (code) => {
        if (settled) return;
        if (code !== 0) {
          finish(reject, new Error(\`computer_executor_exit_\${code}:\${stderr.slice(-500)}\`));
          return;
        }
        try {
          finish(resolve, parseSingleJson(stdout));
        } catch (error) {
          finish(reject, error);
        }
      });
      child.stdin.end(POWERSHELL_BRIDGE, 'utf8');
    });
  } finally {
    await fs.rm(dir, { recursive:true, force:true }).catch(() => {});
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

  #rememberVisualFrame(result) {
    const hash = String(result?.png_sha256 || '').toLowerCase();
    const machine = String(result?.machine_fingerprint_sha256 || '').toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(hash) || !/^[0-9a-f]{64}$/.test(machine)) return false;
    const now = Number(this.#clock());
    this.#visualFrames.set(hash, Object.freeze({ observed_ms: now, machine_fingerprint_sha256: machine }));
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
    this.#visualFrames.delete(hash);
    return { ok:true };
  }

  snapshot() {
    return Object.freeze({
      schema: 'metaengine.windows-local-computer-executor.v1',
      version: '1.0.0',
      platform: this.#platform,
      available: this.#platform === 'win32',
      bridge_sha256: WINDOWS_COMPUTER_BRIDGE_SHA256,
      plane: computerAuthorityPlaneSnapshot(),
      executor_process_model: 'BOUNDED_FIXED_POWERSHELL_BRIDGE',
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
    if (request.action === 'CAPTURE_DESKTOP') this.#rememberVisualFrame(result);
    let projected = result;
    if (request.action === 'OBSERVE_WINDOWS' && Array.isArray(result?.windows)) {
      projected = {
        ...result,
        windows: result.windows.map((row) => ({
          ...row,
          target_identity_sha256: row?.identity ? computerTargetIdentityDigest(row.identity) : null,
        })),
      };
    } else if (['UIA_SNAPSHOT','VERIFY_TARGET'].includes(request.action) && result?.target) {
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
        outcome: 'NO_EFFECT_PROVEN',
        error: visualFence.reason,
      });
    }

    // Any physical effect can invalidate a previous screen observation.
    this.#visualFrames.clear();

    let result;
    try {
      result = await this.#runner(request);
    } catch (error) {
      return projectComputerEffectReceipt({
        request,
        outcome: 'AMBIGUOUS_NO_RETRY',
        error: String(error?.message || error),
      });
    }

    if (result?.ok === true && result?.effect_started === true && result?.readback_proven === true) {
      return projectComputerEffectReceipt({
        request,
        result,
        outcome: 'EFFECT_PROVEN',
      });
    }

    if (result?.effect_started === true) {
      return projectComputerEffectReceipt({
        request,
        result,
        outcome: 'AMBIGUOUS_NO_RETRY',
        error: result?.error || 'computer_effect_readback_not_proven',
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
