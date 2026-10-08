# Runtime Verification Receipts

`native-supervisor.integration.test.mjs` exercises the selected local supervisor through real P256 device signatures and narrowly owned fixtures. It checks enrollment approval, admin grant readback, serial/concurrent nonce replay, signature/timestamp/body/path tampering, device/pairing revocation, admission readback, the unconfirmed resume fence, bounded database inspection and missing command receipts. A cycle probe runs only when admission is closed and verifies zero lease attempts. Protected task, claim, runtime control, supervisor state and command tables are hashed before and after, and the uniquely owned enrollment, device, pairing and nonce fixtures are removed.

The report binds the chosen endpoint and instance UUID to Edge health and authenticated API health before and after the probes. `runtime-verification-bindings.mjs` measures relevant local source modules, Node PostgreSQL dependency source, package lock, Node/Deno binaries, launcher entry and sanitized runtime policy. Paths are relative to the repository or workspace. Private configuration, secrets and credential-derived hashes are excluded.

The candidate includes the repository HEAD, dirty status and status digest. Restore and migration receipts are explicitly bound by file SHA256 and their source snapshot/dump/inventory/migration references. The test rejects disk source or manifest changes, Git/health/instance drift, and mismatched launcher identity during the probes.

To produce complete source bindings, provide these environment variables in addition to the local administrator URL and supervisor URL:

- `LOCAL_STATE_TEST_EXPECTED_INSTANCE_ID`
- `LOCAL_STATE_TEST_API_URL` and `LOCAL_STATE_TEST_API_KEY`
- `LOCAL_STATE_TEST_RESTORE_REPORT_PATH`
- `LOCAL_STATE_TEST_MIGRATION_REPORT_PATH`
- `LOCAL_STATE_TEST_RUNTIME_STATUS_PATH`
- `LOCAL_STATE_TEST_STARTUP_MANIFEST_PATH`
- `LOCAL_STATE_TEST_LAUNCHER_ENTRY_PATH`
- `LOCAL_STATE_TEST_DENO_PATH`
- `LOCAL_STATE_TEST_REPORT_PATH`

Missing required bindings limit the receipt to `SMOKE_ONLY`. Complete and stable disk bindings without a matching startup receipt produce `SOURCE_BOUND_SMOKE`. With the actual launcher's startup receipt, the verifier checks the exact instance and endpoint, compares current API/Edge source and resolved Node/Deno PostgreSQL dependency bytes with that receipt, and produces `STARTUP_MANIFEST_BOUND_SMOKE`. Database capability attestation and file hashes are not loaded-code attestation. Compiled caches and process memory are not measured. The receipt explicitly states that PostgreSQL executable bytes were measured during launch but are not repeated by the signed probe. These limits remain explicit even when all functional probes pass.
