# METAENGINE Browser — Step 10 Windows receipt gate correction

Date: 2026-08-29
Branch: `work/metaengine-browser-shell-v1`

## Evidence

The Windows Server 2022 artifact for exact head `b864b970fee17bbec167f166f4f708d5aab79a4b` contains a complete successful DP0 trace:

`MODULE_LOADED -> APP_READY -> DP_MODULE_IMPORTED -> DP_STARTING -> DP_READY -> DP_REQUESTS_COMPLETE -> DP_STOPPED -> COMPLETE -> APP_EXIT`

The physical receipt reports:
- `ok=true`;
- Development Plane version `0.1.3`;
- repository head equal to the exact workflow head;
- `direct_promote_current=false`;
- shutdown state `STOPPED`;
- cooperative shutdown ACK true;
- `APP_EXIT` code 0.

Therefore the failing Windows Actions step is a CI wrapper false negative, not a DP runtime failure.

## Root cause

The wrapper used `Start-Process -PassThru`, `WaitForExit()` and then relied on the PowerShell process object's `ExitCode` property. In this hosted-runner path the application produced a complete code-0 stage trace while the wrapper still failed its `ExitCode` check.

## Correction

The Windows gate now treats the application-owned stage trace as the authoritative physical receipt and requires all of:
- `MODULE_LOADED`;
- `APP_READY`;
- `COMPLETE` with `ok=true`;
- `shutdown_state=STOPPED`;
- cooperative shutdown ACK;
- `APP_EXIT` with code 0.

`WaitForExit(30000)` remains as an outer bounded process-liveness fence. The wrapper no longer makes a weaker, platform-specific `ExitCode` accessor override stronger application evidence.

## Authority

No product capability changes. DP0 remains read-only and cannot promote or actuate the browser.
