# R97 presentation route fixture — 2026-10-25

Source base: `9a19ae7153f1213f3f43682a24aa0ba3bb105586`.
Integrated onto onboarding commit `e0768f0e9413f2f9838a53fa7e3497a297bf0231`, preserving its onboarding test byte-for-byte. Startup diagnostics and audit are copied exactly from PR #1346 commit `34e00d875388031ba44ab24ecedce0902fdcc94a`.

## Diagnosis and change

The standalone Electron presentation harness registers its own IPC handlers. It lacked `metaengine:client:goal-submission-mode`, which the actual preload and renderer read before submission. Production main already registers the read-only handler; this is harness contract drift, not an installed-client startup fix.

Add an isolated BROWSER / HOST_VERIFICATION_REQUIRED route fixture: no authority effect, no automatic retry, rejection of supplied parameters. Separate work-readiness and all existing simulated receipts remain unchanged. New tests execute actual registration and preload in a VM, compare the production absent-profile contract, reject parameters, and prove reads neither create nor mutate goal receipts or increment submission count. Production code, permits, recovery fences, screenshot gates and timeouts are unchanged.

## Source verification

Cloud Linux, Node v24.22.1, selected-source workspace with 32 unchanged source blobs checked against the base Git tree. Remote onboarding and diagnostic files checked against their Git blob hashes. No synthetic dependency modules.

```sh
node --test --test-concurrency=1 infra/client-state-runtime/attached-postgres-onboarding.test.mjs infra/client-state-runtime/db-api-grants.test.mjs apps/metaengine-browser/test/r97-goal-submission-mode.test.mjs apps/metaengine-browser/test/client-native-coding-goal.test.mjs apps/metaengine-browser/test/r97-visual-capture-digest-w69.test.mjs apps/metaengine-browser/test/startup-independence-diagnostic.test.mjs apps/metaengine-browser/test/shell-first-startup-boundary.test.mjs
```

Result: **53 passed, 0 failed, 1 Windows-only skip** (54 tests). The new route suite previously failed all three cases with the missing handler. Focused tests are not full repository, Electron visual, installed-client, live PostgreSQL, native capability or autonomous-agent proof.

## Separate CI evidence

The existing `client-wave10-w62-source-r97.yml` automatically selects presentation harness changes on pull requests. It uses Windows-2025 and exact PR head, frozen tooling, disposable Electron, UI build/pack without installer identity reservation, screenshot checks and artifact digests. No workflow change or manual packaging rerun is needed. Its outcome must be checked separately on the integrated SHA; no visual pass is claimed here. Other packaging workflows may still fail immutable version reservation; no version bump, reservation bypass, merge or deployment is included.
