# C1 Native R16 Rejoin — Checkpoint 1

Status: IMPLEMENTED / GITHUB_C1_GATE_GREEN
Date: 2026-08-29
Authority effect: false for this convergence checkpoint; no production authority mutation.

## Exact lineage

- Source integration line: `integration/compute-unified-v1` @ `03684f0731e6d12dc477c09f217ea2bca3aa29db`.
- Native source observed: `work/metaengine-browser-native-supervisor-v1` @ `0a3d9300959b6220f24b3014b0359c9566b2f169`.
- Compute Browser B4/B7-PRE1 source observed: `work/a2-compute-browser-b4-parity` @ `b3fe90cb77531222ba67797ab3b0d11282cb7eaa`.
- Native vs integration merge-base: `c50dd08650a81305c42ab8369e0e519df35ff321`; Native was 88 commits ahead / 286 behind integration.
- B4/B7 vs integration merge-base: `c50dd08650a81305c42ab8369e0e519df35ff321`; B4/B7 was 45 commits ahead / 286 behind integration.
- C1 work branch: `work/convergence-native-r16-v1`, created exactly from integration SHA above.
- Slice-1 implementation commit: `61b20ab45fdf0605543d4be288ef657c32cb838b`.
- Slice-1 implementation tree: `4525260545f331955771dba616a3abe08ea67e0d`.

## Why this slice

The source families are deeply diverged, so a history merge/cherry-pick train would risk overwriting the R16 control plane. Slice 1 is additive-only on the R16 tree. It imports the independently useful Native physical edge and wraps consequential actuation in an R16-specific gate instead of importing the old authority seam unchanged.

Imported from Native Browser by exact blob identity:

- `apps/metaengine-browser/src/browser-policy.mjs` — `bc4e113c5205e58a63783c0ef4dfb988c187ee0f`
- `apps/metaengine-browser/src/native-browser-control.mjs` — `38b55b705fd73571a97cea12844d7b5d5d956d28`
- `apps/metaengine-browser/src/native-supervisor-client.mjs` — `70afc0a60e296f7500efb9a08632f8be57efe368`
- `apps/metaengine-browser/src/supervisor-device-identity.mjs` — `8580d7f08b30d4a43262b20f98ede88daaddcf16`
- Native tests: `02d720d94b7d4c5d92aa0a764fc181b012cabe3a`, `61eb740012d3c90a9501d4a1a7c9944536f605c5`

Imported from B4/B7-PRE1 as evidence-only durability substrate:

- `coordination/browser-shared/effect-ledger.mjs` — `922ca40037a2590ef2b20d2ec179528e0cc33153`
- `coordination/browser-compute/src/effect-ledger-store.mjs` — `eaa0f03a2cf99b136ea1f8231e3a06deeead7eb7`

New R16 adapter:

- `apps/metaengine-browser/src/native-r16-actuation-gate.mjs`
- `apps/metaengine-browser/test/r16-rejoin-gate.test.mjs`
- `.github/workflows/convergence-native-r16-v1.yml`

## Preserved hard contracts

- `REMOTE_CODE_IS_NEVER_EVALLED_IN_BROWSER_KERNEL`: Native semantic control uses Accessibility/DOM/Input CDP and the convergence sentinel rejects `eval`, `new Function`, and `Runtime.evaluate` in the Native actuation path.
- `PAGE_DATA_HAS_ZERO_AUTHORITY`: browser policy remains `page_data_authority: false`; page-derived semantic data is target data only.
- `ONE_RESOURCE_ONE_ACTUATION_LEASE`: every consequential Native command must present an exact active, unexpired, single-use `ACTUATE` lease bound to holder/resource/action/browser-node/process-incarnation/profile/target.
- `PRE_ACTUATION_DURABLE_BEFORE_EFFECT`: `INTENT_SEALED` and `AUTHORITY_GRANTED` are durably appended before the physical executor runs.
- `NO_BLIND_RETRY_AFTER_AMBIGUOUS_EFFECT`: any post-intent exception records `RECOVERY_REQUIRED`; subsequent use of the same `action_id` fails closed before physical dispatch.
- The imported ledger is evidence only and cannot mint authority or a lease.

## Verification

GitHub Actions workflow: `C1 Native R16 Rejoin`

- Run: `33255058756`
- Job: `99107195733` (`native-r16-safety-gate`)
- Head: `61b20ab45fdf0605543d4be288ef657c32cb838b`
- Conclusion: `success`
- Native edge parse + Native/R16 contract tests: PASS
- R9-R16 router/safety regressions: PASS
- inherited R5-R8 physical-actuator regressions: PASS

Repository-wide AppVeyor branch status was still `pending` at checkpoint capture (`builds/54625529`); it is not used to claim the C1 gate result above.

## Explicit non-actions

- `main` was not merged or modified.
- `integration/compute-unified-v1` was not moved.
- Historical PRs/branches were not closed.
- Supabase/provider configuration, secrets, spend and production authority were not changed.
- No lease-minting authority was added to the Native edge.

## Next C1 slice

Rejoin the persistent Electron session shell around this already-gated edge: port/adapt `main.mjs`, `tab-registry.mjs`, `preload-shell.cjs`, secure-storage identity wiring and the minimal UI/session lifecycle; make every supervisor physical command enter through `NativeR16ActuationGate` rather than the old direct executor seam; then add a Windows Electron physical E2E that proves persistent session restart, signed supervisor transport, exact target/process-incarnation binding, durable pre-actuation evidence and ambiguous-effect hold. Only after that should fleet provisioner and Development Plane integration be layered onto the unified shell.
