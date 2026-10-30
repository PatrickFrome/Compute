#!/usr/bin/env bash
# Source-only reproduction: pre-existing dependencies and disposable OWN PostgreSQL17.
# No install/download, cloud/native Windows qualification, or publication.
set -euo pipefail
cd "$(dirname "$0")/../../.."
: "${METAENGINE_PG_TEST_BIN:?Point to existing PostgreSQL17 bin directory}"
: "${METAENGINE_PG_TEST_DRIVER:?Point to existing postgres JS driver entrypoint}"
out="${METAENGINE_PHASE_1B_LOG_DIR:-$(mktemp -d /tmp/metaengine-phase1b-verification.XXXXXX)}"
mkdir -p "$out"
components=(
  'apps/metaengine-browser/test/client-prepared-goal.test.mjs'
  'apps/metaengine-browser/test/client-prepared-goal-activation.test.mjs'
  'apps/metaengine-browser/test/client-native-coding-goal.test.mjs'
  'apps/metaengine-browser/test/native-supervisor-initialization-lifetime.test.mjs'
  'apps/metaengine-browser/test/native-host-scope-cleanup.test.mjs'
  'apps/metaengine-browser/test/native-coding-host-ipc.test.mjs'
  'apps/metaengine-browser/test/local-runtime-host-controller.test.mjs'
  'apps/metaengine-browser/test/local-runtime-host-terminal.test.mjs'
  'apps/metaengine-browser/test/managed-runtime-drain.test.mjs'
  'apps/metaengine-browser/test/installer-resident-shutdown.test.mjs'
  'apps/metaengine-browser/test/client-admission-recovery.test.mjs'
  'apps/metaengine-browser/test/runtime-recovery-main-mount.test.mjs'
  'apps/metaengine-browser/test/host-resilience-stop-fence.test.mjs'
  'apps/metaengine-browser/test/native-coding-pending-owner-phase.test.mjs'
  'apps/metaengine-browser/test/native-coding-pending-activation-phase.test.mjs'
  'apps/metaengine-browser/test/source-check-runner.test.mjs'
  'apps/metaengine-browser/test/host-owner-protected-identity-w74.test.mjs'
  'apps/metaengine-browser/test/host-owner-genesis-custody-w74.test.mjs'
  'apps/metaengine-browser/test/installed-executable-provenance-w68.test.mjs'
  'apps/metaengine-browser/test/native-coding-runtime.test.mjs'
  'infra/client-state-runtime/native-coding-preparation-transaction.test.mjs'
  'infra/client-state-runtime/native-coding-host-authority.test.mjs'
  'infra/client-state-runtime/native-coding-host-transaction-scope.test.mjs'
  'infra/client-state-runtime/native-coding-host-seed-service.test.mjs'
  'infra/client-state-runtime/native-coding-host-commit-service.test.mjs'
  'infra/client-state-runtime/native-coding-host-seed-binding.test.mjs'
  'infra/client-state-runtime/native-coding-workspace-preparation.test.mjs'
  'infra/client-state-runtime/native-coding-pending-activation-profile.test.mjs'
  'infra/client-state-runtime/runtime-host.test.mjs'
  'infra/client-state-runtime/native-host-startup-lifecycle.test.mjs'
  'infra/client-state-runtime/package-runtime-resources.test.mjs'
  'infra/client-state-runtime/windows-qualification-registration.test.mjs'
  'infra/client-state-runtime/native-coding-agent-host-tools.test.mjs'
  'apps/me2-ui/src/lib/goal-journal-readback.ui.test.mjs'
)
for file in "${components[@]}"; do test -f "$file"; done
node --test --test-reporter=tap --test-concurrency=1 "${components[@]}" > "$out/phase-1b-components.tap" 2>&1
pg=(
  'infra/client-state-runtime/native-coding-pending-goal.pg17.test.mjs'
  'infra/client-state-runtime/native-coding-workspace-preparation.pg17.test.mjs'
  'infra/client-state-runtime/host-owner-preseal-w74.pg17.test.mjs'
  'infra/client-state-runtime/native-coding-service-admission.integration.test.mjs'
)
for file in "${pg[@]}"; do test -f "$file"; done
node --test --test-reporter=tap --test-concurrency=1 "${pg[@]}" > "$out/phase-1b-pg17.tap" 2>&1
(cd apps/metaengine-browser && node scripts/check-source.mjs) > "$out/phase-1b-source.log" 2>&1
(cd apps/me2-ui && node node_modules/typescript/bin/tsc --noEmit) > "$out/phase-1b-typescript.log" 2>&1
git diff --check
printf 'component files: %s; PG17 files: %s\n' "${#components[@]}" "${#pg[@]}"
tail -9 "$out/phase-1b-components.tap"
tail -9 "$out/phase-1b-pg17.tap"
cat "$out/phase-1b-source.log"
printf 'TypeScript and diff-check: PASS; logs: %s\n' "$out"
