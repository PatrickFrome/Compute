# Owner and shared-ticket integration checkpoint

This is a source repair checkpoint, not installer or installed-runtime qualification.

## Source lineage

The local integration retains the collected source tree 6538e4adad9196654881cf595a20221ad5333cd4 (public equivalent d4de8e05af622b1dfd02261373dbf46af7434b94), active Owner 1cfbcdfc14e55449d5aa8c71e12f7887eb30ff3c and the reviewed changes from shared-ticket da0924351828d61e9ff373ce9bce5c5665ee84a3. The two IPC merge conflicts were resolved by retaining the shared physical ticket/request maps and the fixed Owner phase on both peers. No gate was lifted and no installed state was changed.

## Reproduced and repaired

1. Active-project PG fixture registered a provider but omitted the mandatory service heartbeat. Its actual W30 call returned `leased:false`. The fixture now first proves that registration alone cannot lease, then publishes a signed v2 heartbeat using the real capacity SQL census and existing Host service. The real activated project now reaches its original reservation and bounded Owner read phase. Native observations remain generated and are explicitly refused as native qualification.
2. The publisher required the immutable sealed Owner timestamp to be current. This was incompatible with the actual Owner reader, which returns the original sealed record and a separate fresh observation. Freshness now validates the independent observation. Tests accept an old unchanged seal with a fresh observation and reject missing, invalid, stale and future current observations.
3. A before/after publication snapshot compared Owner and physical lineage but omitted current control. A real-PG regression changed the control revision while both admission booleans remained true and unexpectedly succeeded. Snapshot stability now includes the complete current control object. The regression is red before and green after the repair.

## Checks and limits

- Active Owner plus current control, actual disposable PostgreSQL 17: 35 passed, zero failed/skipped on integrated source.
- Publisher/hand-off actual disposable PostgreSQL 17: 61 passed, zero failed/skipped after the final control repair. Owner/native evidence is generated, not installed evidence.
- Integrated Host IPC, Owner phase/reader, handoff and publication source checks: 148 passed, zero failed/skipped before the final control-only repair.
- Protected callback-prefix suite: 12 passed.
- Source parser: 274 modules passed before the final control-only repair.
- Broader Browser native selection: 507 passed, 16 failed, 7 platform skips. Fifteen failures are local socket listen failures in this executor (a minimal socket reproduction returned EPERM). One failure was absent @electron/asar. The existing pinned 4.3.0 package was subsequently selected via NODE_PATH and the complete two-test package-closure file passed. This does not make the original broad run green.
- Supported escalation of the socket test failed before execution because its execution wrapper could not initialize. No restriction was modified or bypassed.
- Windows verification of this integrated source is still pending. Prior Windows runs on other source revisions do not qualify this checkpoint.

## Still open

The default publisher is not wired through the current native Owner phase, initial protected run anchor and original physical ticket as one production path. Publication SQL remains unregistered and the default directory/publication gate remains closed. Historical all-effects settlement/capacity recovery, first-run materialization, effective probe/runner environment identity, protected release signing and sidecar placement, exact-source Windows packaging and installed update/rollback/full autonomous-flow validation remain required. No version reservation, installer readiness, production qualification or main merge is asserted.

Later checks on the control-repaired source: the broad Host native-coding selection finished with 298 passed, zero failed and 21 skipped (including real-PG cases without their explicit fixture environment). Separately configured PG results above are not added to this count. The connected Windows command channel stopped responding after a successful public-ref fetch; a read-only directory status request reached terminal timeout. No Windows result or successful transfer is inferred from the stale online label.

Additional environment hardening: child environment names are canonicalized to uppercase and conflicting Windows aliases are rejected; all TEMP/TMP/TMPDIR aliases are removed before setting the protected per-run directory. Runner/probe selection: 44 passed and 8 native platform skips. The probe producer now requires explicit absolute authentication-home and scratch-root selections, verifies the existing home ACL and refuses overlap before creating files or spawning. Probe selection: 28 passed and one Windows boot skip. These changes remove ambient selection but do not prove equivalent effective managed policy, physical identity or runner use of the receipt; P0 environment equivalence remains open.

Exact-source CI on 16896a2c72812928669c7d2a4f7e3046e4d6b4af exposed four actual Host bundle-plan failures (`bundle_unexpected_source_record`). Local reproduction confirmed that the real runtime-host import graph reaches the fixed Owner phase and publication handoff contract, but the explicit Browser-to-Host source catalog omitted those two paths. Only those exact paths were added, with negative copy/lookalike cases retained and expanded. The full package-runtime-resources test file is now 42/42 passing locally. No wildcard catalog widening, SQL registration or readiness change was made. Offline dependency installation was unavailable in this executor; the test used the already available postgres 3.4.7 package, while CI installs its frozen lock normally.

A subsequent Windows component run timed out after the first explicit-probe-input case. The sanitized CI artifact and direct Windows log both identify the next overlap test as blocked. Reproduction using path.win32 in the Linux fixture reproduced its timeout in five seconds: raw string equality did not recognize the same scratch root with different separators/drive casing. Root equality now uses path.relative, and fixtures exercise both native and Windows path semantics plus drive/case/trailing-separator aliases. The regression test has a bounded timeout so an error cannot hang the entire component job. Production deadlines and path-denial policy are unchanged. Local probe checks: 29 passed, one genuine Windows boot check skipped.
