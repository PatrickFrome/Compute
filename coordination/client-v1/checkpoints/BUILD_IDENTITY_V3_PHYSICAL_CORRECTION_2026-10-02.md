# Build Identity V3 physical qualification correction — 2026-10-02

Failed physical head: `245920c1a45851a1d30c25341ce2ca33457bc5c7`  
PR: #1093  
Package Smoke: #3144 / run `36988305577`  
Self Update: #3597 / run `36988305490`  
Consumed package identity: `0.7.0-dev.36980000001.1`  
Successor reservation: `0.7.0-dev.36990000001.1`

The old identity is consumed because Package Smoke started and published immutable version-reservation artifact `11218079311` (digest `sha256:8c9bea4e65699be2e54fa6053985224dc50db68fd8c187783df0620c2cc72d0b`).

Self Update failed before installer acquisition/effect in `test/qualified-installer-consumer-verify.ps1`. The exact exception was a PowerShell StrictMode missing-property failure for `package_lock_sha256`.

Root cause: V3 added lock/Bun evidence to the shared qualified-installer binding, but Verify and terminal-gate projection read those V3-only properties unconditionally. Historical V2 bindings are valid without those properties.

Correction:
- retain V2/V3 provenance acceptance;
- compare package-lock/npm/Bun/UI-lock fields only when provenance schema is V3;
- emit those fields from terminal producer gate only for V3;
- keep all V3 checks fail-closed;
- run the behavioral V2 compatibility fixture inside source-only Windows qualification.

No updater or installer effect was observed in the failed Self Update job.

This correction and the package-version advance are one atomic source commit. The draft PR was closed before the correction push so the successor version can complete source-only qualification before a new physical producer starts.

authority_effect=false  
live_install_effect=false
