param(
    [Parameter(Mandatory = $true)]
    [string]$ProbeExe
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$root = Join-Path $env:ProgramData 'METAENGINE\Guardian'
$metaRoot = Split-Path -Parent $root
$metaRootPreexisting = Test-Path -LiteralPath $metaRoot
$recordPath = Join-Path $root 'owner-enrollment-v1.record'
$reparseTarget = Join-Path $env:RUNNER_TEMP 'metaengine-owner-store-reparse-target'
$sidA = 'S-1-5-21-1000-1001-1002-1003'
$sidB = 'S-1-5-21-2000-2001-2002-2003'
$evidenceA = 'a' * 64
$evidenceB = 'c' * 64
$deviceA = 'b' * 64
$deviceB = 'd' * 64

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw $Message }
}

function Invoke-Icacls {
    param([string[]]$Arguments)
    & icacls.exe @Arguments | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "icacls_failed_$LASTEXITCODE arguments=$($Arguments -join ' ')" }
}

function Remove-PathSafely {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return }
    $item = Get-Item -LiteralPath $Path -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        Remove-Item -LiteralPath $Path -Force
    } else {
        Remove-Item -LiteralPath $Path -Force -Recurse
    }
}

function Reset-SecureRoot {
    Remove-PathSafely -Path $root
    New-Item -ItemType Directory -Path $root -Force | Out-Null
    Invoke-Icacls -Arguments @($root, '/inheritance:r', '/grant:r', '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F')
    Invoke-Icacls -Arguments @($root, '/setowner', '*S-1-5-32-544')
}

function Secure-RecordAcl {
    Invoke-Icacls -Arguments @($recordPath, '/inheritance:r', '/grant:r', '*S-1-5-18:F', '*S-1-5-32-544:F')
    Invoke-Icacls -Arguments @($recordPath, '/setowner', '*S-1-5-32-544')
}

function Invoke-ProbeRead {
    $raw = @(& $ProbeExe read)
    if ($LASTEXITCODE -ne 0) { throw "owner_store_probe_read_exit_$LASTEXITCODE" }
    $line = ($raw | Where-Object { $_.Trim() } | Select-Object -Last 1)
    if (-not $line) { throw 'owner_store_probe_read_output_missing' }
    return $line | ConvertFrom-Json
}

function Invoke-ProbeCreate {
    param([string]$Sid, [string]$Evidence, [string]$Device)
    $raw = @(& $ProbeExe create $Sid $Evidence $Device)
    if ($LASTEXITCODE -ne 0) { throw "owner_store_probe_create_exit_$LASTEXITCODE" }
    $line = ($raw | Where-Object { $_.Trim() } | Select-Object -Last 1)
    if (-not $line) { throw 'owner_store_probe_create_output_missing' }
    return $line | ConvertFrom-Json
}

function Start-ProbeCreateProcess {
    param([string]$Sid, [string]$Evidence, [string]$Device)
    $start = New-Object System.Diagnostics.ProcessStartInfo
    $start.FileName = $ProbeExe
    $start.Arguments = "create $Sid $Evidence $Device"
    $start.UseShellExecute = $false
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $start.CreateNoWindow = $true
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $start
    if (-not $process.Start()) { throw 'owner_store_race_process_start_failed' }
    return $process
}

function Complete-ProbeCreateProcess {
    param([System.Diagnostics.Process]$Process, [string]$Label)
    $Process.WaitForExit()
    $stdout = $Process.StandardOutput.ReadToEnd()
    $stderr = $Process.StandardError.ReadToEnd()
    $exitCode = $Process.ExitCode
    $Process.Dispose()
    if ($exitCode -ne 0) { throw "${Label}_exit_${exitCode}:$stderr" }
    if (-not $stdout.Trim()) { throw "${Label}_output_missing" }
    return $stdout | ConvertFrom-Json
}

function Assert-ExactRecord {
    param($Result, [string]$Sid, [string]$Evidence, [string]$Device, [string]$Prefix)
    Assert-True $Result.present "${Prefix}_not_present"
    Assert-True (-not $Result.corrupt) "${Prefix}_corrupt"
    Assert-True $Result.root_trusted "${Prefix}_root_untrusted"
    Assert-True ($Result.record.expected_owner_sid -eq $Sid) "${Prefix}_sid_mismatch"
    Assert-True ($Result.record.enrollment_evidence_sha256 -eq $Evidence) "${Prefix}_evidence_mismatch"
    Assert-True ($Result.record.device_key_fingerprint_sha256 -eq $Device) "${Prefix}_device_mismatch"
}

try {
    if (-not (Test-Path -LiteralPath $ProbeExe -PathType Leaf)) { throw 'owner_store_runtime_probe_missing' }

    Reset-SecureRoot
    $created = Invoke-ProbeCreate -Sid $sidA -Evidence $evidenceA -Device $deviceA
    Assert-ExactRecord -Result $created -Sid $sidA -Evidence $evidenceA -Device $deviceA -Prefix 'create'
    Assert-True $created.committed 'create_not_committed'
    Assert-True $created.exact 'create_not_exact'
    Assert-True $created.provenance_exact 'create_provenance_not_exact'
    Assert-True $created.staging_flushed 'create_staging_not_flushed'
    Assert-True $created.move_committed 'create_move_not_committed'
    Assert-True $created.post_commit_readback 'create_post_commit_readback_missing'

    $identical = Invoke-ProbeCreate -Sid $sidA -Evidence $evidenceA -Device $deviceA
    Assert-ExactRecord -Result $identical -Sid $sidA -Evidence $evidenceA -Device $deviceA -Prefix 'identical'
    Assert-True (-not $identical.committed) 'identical_candidate_recommitted'
    Assert-True $identical.exact 'identical_candidate_not_exact'
    Assert-True $identical.provenance_exact 'identical_candidate_provenance_not_exact'

    $sameOwnerDifferentProof = Invoke-ProbeCreate -Sid $sidA -Evidence $evidenceB -Device $deviceB
    Assert-ExactRecord -Result $sameOwnerDifferentProof -Sid $sidA -Evidence $evidenceA -Device $deviceA -Prefix 'same_owner_different_proof'
    Assert-True (-not $sameOwnerDifferentProof.committed) 'same_owner_different_proof_recommitted'
    Assert-True $sameOwnerDifferentProof.exact 'same_owner_different_proof_owner_not_exact'
    Assert-True (-not $sameOwnerDifferentProof.provenance_exact) 'same_owner_different_proof_unexpectedly_exact'

    $mismatch = Invoke-ProbeCreate -Sid $sidB -Evidence $evidenceB -Device $deviceB
    Assert-ExactRecord -Result $mismatch -Sid $sidA -Evidence $evidenceA -Device $deviceA -Prefix 'owner_mismatch'
    Assert-True (-not $mismatch.committed) 'owner_mismatch_recommitted'
    Assert-True $mismatch.owner_mismatch 'owner_mismatch_not_reported'

    Reset-SecureRoot
    [IO.File]::WriteAllText($recordPath, "malformed`n", [Text.Encoding]::ASCII)
    Secure-RecordAcl
    $malformed = Invoke-ProbeRead
    Assert-True $malformed.present 'malformed_record_not_present'
    Assert-True $malformed.corrupt 'malformed_record_not_corrupt'
    Assert-True $malformed.root_trusted 'malformed_record_root_untrusted'

    Reset-SecureRoot
    [IO.File]::WriteAllText($recordPath, ('x' * 4096), [Text.Encoding]::ASCII)
    Secure-RecordAcl
    $oversized = Invoke-ProbeRead
    Assert-True $oversized.present 'oversized_record_not_present'
    Assert-True $oversized.corrupt 'oversized_record_not_corrupt'

    Reset-SecureRoot
    Invoke-Icacls -Arguments @($root, '/grant', '*S-1-5-32-545:(OI)(CI)M')
    $writableRoot = Invoke-ProbeRead
    Assert-True (-not $writableRoot.root_trusted) 'low_privilege_writable_root_accepted'
    Assert-True (-not $writableRoot.present) 'low_privilege_writable_root_read_record'

    Reset-SecureRoot
    Remove-PathSafely -Path $root
    Remove-PathSafely -Path $reparseTarget
    New-Item -ItemType Directory -Path $reparseTarget -Force | Out-Null
    New-Item -ItemType Junction -Path $root -Target $reparseTarget | Out-Null
    $reparse = Invoke-ProbeRead
    Assert-True (-not $reparse.root_trusted) 'reparse_root_accepted'
    Assert-True (-not $reparse.present) 'reparse_root_read_record'

    Reset-SecureRoot
    $processA = Start-ProbeCreateProcess -Sid $sidA -Evidence $evidenceA -Device $deviceA
    $processB = Start-ProbeCreateProcess -Sid $sidB -Evidence $evidenceB -Device $deviceB
    $raceA = Complete-ProbeCreateProcess -Process $processA -Label 'race_a'
    $raceB = Complete-ProbeCreateProcess -Process $processB -Label 'race_b'
    $commitCount = 0
    foreach ($raceResult in @($raceA, $raceB)) { if ($raceResult.committed) { $commitCount += 1 } }
    Assert-True ($commitCount -eq 1) "race_commit_count_$commitCount"

    $final = Invoke-ProbeRead
    Assert-True $final.present 'race_final_record_absent'
    Assert-True (-not $final.corrupt) 'race_final_record_corrupt'
    Assert-True $final.root_trusted 'race_final_root_untrusted'
    Assert-True (@($sidA, $sidB) -contains $final.record.expected_owner_sid) 'race_final_sid_unknown'
    if ($final.record.expected_owner_sid -eq $sidA) {
        Assert-True ($final.record.enrollment_evidence_sha256 -eq $evidenceA) 'race_final_a_evidence_mismatch'
        Assert-True ($final.record.device_key_fingerprint_sha256 -eq $deviceA) 'race_final_a_device_mismatch'
        Assert-True $raceB.owner_mismatch 'race_loser_b_not_mismatch'
    } else {
        Assert-True ($final.record.enrollment_evidence_sha256 -eq $evidenceB) 'race_final_b_evidence_mismatch'
        Assert-True ($final.record.device_key_fingerprint_sha256 -eq $deviceB) 'race_final_b_device_mismatch'
        Assert-True $raceA.owner_mismatch 'race_loser_a_not_mismatch'
    }

    Write-Host 'Guardian owner-enrollment durable store runtime proof: PASS'
} finally {
    Remove-PathSafely -Path $root
    if (-not $metaRootPreexisting -and (Test-Path -LiteralPath $metaRoot)) {
        $remaining = @(Get-ChildItem -LiteralPath $metaRoot -Force -ErrorAction SilentlyContinue)
        if ($remaining.Count -eq 0) { Remove-Item -LiteralPath $metaRoot -Force }
    }
    Remove-PathSafely -Path $reparseTarget
}
