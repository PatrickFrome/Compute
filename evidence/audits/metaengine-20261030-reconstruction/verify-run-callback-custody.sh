#!/usr/bin/env bash
# Callback custody/journal prerequisite SOURCE only. No durable Host lineage or historical capacity release.
# Existing pinned dependencies and disposable own PostgreSQL17; no install/network.
set -euo pipefail
cd "$(dirname "$0")/../../.."
: "${METAENGINE_PG_TEST_BIN:?Existing PostgreSQL17 bin directory required}"
: "${METAENGINE_PG_TEST_DRIVER:?Existing postgres 3.4.7 driver required}"
out="${METAENGINE_CALLBACK_CUSTODY_LOG_DIR:-$(mktemp -d /tmp/metaengine-callback-custody.XXXXXX)}"
mkdir -p "$out"
node --test --test-timeout=60000 --test-reporter=tap --test-concurrency=1 \
 apps/metaengine-browser/test/codex-cli-*.test.mjs \
 apps/metaengine-browser/test/native-coding-host-observers.test.mjs \
 apps/metaengine-browser/test/native-coding-agent-close-lifetime.test.mjs \
 infra/client-state-runtime/native-coding-protected-settlement.test.mjs \
 infra/client-state-runtime/native-coding-host-os-scope.test.mjs \
 infra/client-state-runtime/native-coding-execution-readback.test.mjs \
 infra/client-state-runtime/native-coding-host-authority-review.test.mjs > "$out/helper-reader.tap" 2>&1
node --test --test-timeout=60000 --test-reporter=tap infra/client-state-runtime/native-coding-host-authority.integration.test.mjs > "$out/protected-receipt-pg17.tap" 2>&1
node --test --test-timeout=60000 --test-reporter=tap --test-concurrency=1 \
 apps/metaengine-browser/test/native-coding-capacity-owner.test.mjs \
 apps/metaengine-browser/test/native-coding-capacity-contract.test.mjs \
 apps/metaengine-browser/test/native-coding-capacity-first-dispatch.test.mjs \
 apps/metaengine-browser/test/native-coding-service-heartbeat-publisher.test.mjs \
 apps/metaengine-browser/test/native-coding-execution-pool.test.mjs \
 apps/metaengine-browser/test/native-coding-lease-executor.test.mjs \
 apps/metaengine-browser/test/native-coding-runtime.test.mjs \
 apps/metaengine-browser/test/client-native-coding-goal.test.mjs \
 apps/metaengine-browser/test/devos-native-coding-cycle.test.mjs \
 apps/metaengine-browser/test/devos-native-task-cycle.test.mjs \
 apps/metaengine-browser/test/devos-concurrent-dispatch.test.mjs \
 apps/metaengine-browser/test/devos-supervisor-cycle-transport-fence.test.mjs \
 apps/metaengine-browser/test/native-coding-server-admission.test.mjs \
 infra/client-state-runtime/native-host-startup-lifecycle.test.mjs \
 infra/client-state-runtime/native-coding-host-capacity.test.mjs \
 infra/client-state-runtime/native-coding-host-authority.test.mjs \
 infra/client-state-runtime/native-coding-host-capabilities.test.mjs \
 infra/client-state-runtime/local-runtime-migrations.test.mjs \
 infra/client-state-runtime/package-runtime-resources.test.mjs > "$out/components.tap" 2>&1
node --test --test-timeout=60000 --test-reporter=tap --test-concurrency=1 \
 apps/metaengine-browser/test/native-coding-host-ipc.test.mjs \
 apps/metaengine-browser/test/native-coding-run-callback-journal.test.mjs \
 apps/metaengine-browser/test/native-coding-agent-callback-custody.test.mjs \
 apps/metaengine-browser/test/native-coding-agent-run-bridge.test.mjs \
 apps/metaengine-browser/test/native-host-scope-cleanup.test.mjs \
 apps/metaengine-browser/test/managed-runtime-drain.test.mjs \
 apps/metaengine-browser/test/native-supervisor-initialization-lifetime.test.mjs \
 apps/metaengine-browser/test/runtime-recovery-main-mount.test.mjs \
 apps/metaengine-browser/test/client-prepared-goal-activation.test.mjs \
 apps/metaengine-browser/test/client-draft-scope.test.mjs \
 apps/metaengine-browser/test/client-native-setup-route.test.mjs \
 infra/client-state-runtime/native-coding-preparation-transaction.test.mjs \
 infra/client-state-runtime/native-coding-device-request.test.mjs \
 infra/client-state-runtime/native-coding-capacity-source.test.mjs > "$out/lifetime.tap" 2>&1
node --test --test-timeout=60000 --test-reporter=tap --test-concurrency=1 \
 infra/client-state-runtime/native-coding-capacity.pg17.test.mjs \
 infra/client-state-runtime/native-coding-service-admission.integration.test.mjs \
 infra/client-state-runtime/native-coding-setup.pg17.test.mjs > "$out/pg17.tap" 2>&1
node --test --test-timeout=60000 --test-reporter=tap apps/metaengine-browser/test/native-published-scope-drain.pg17.test.mjs > "$out/published-scope-pg17.tap" 2>&1
LOCAL_STATE_TEST_PROJECT_PG_BIN_DIR="$METAENGINE_PG_TEST_BIN" METAENGINE_MIGRATION_TEST_LOG="$out/full-migration.pg.log" \
 node --test --test-timeout=60000 --test-reporter=tap infra/client-state-runtime/local-runtime-migrations.integration.test.mjs > "$out/full-migration.tap" 2>&1
(cd apps/metaengine-browser && node scripts/check-source.mjs) > "$out/source.log" 2>&1
node --check apps/metaengine-browser/test/native-coding-capacity-first-dispatch.test.mjs
node --check infra/client-state-runtime/native-coding-capacity.pg17.test.mjs
git diff --check;git diff --cached --check
for log in helper-reader.tap protected-receipt-pg17.tap components.tap lifetime.tap pg17.tap published-scope-pg17.tap full-migration.tap;do tail -9 "$out/$log";done
cat "$out/source.log"
printf 'Run callback custody prerequisite SOURCE checkpoint only. No Windows/native or autonomous next-task acceptance.\n'
printf 'Scoped callback candidate LINEAGE_UNBOUND; receipt Host callbacks NOT_ATTESTED; all-effects UNCONFIRMED; historical capacity release DISABLED.\n'
printf 'Materializer and setup physical handoff UNBOUND.\n'
printf 'Required separate socket lane BLOCKED; UI dependency lane FAIL/BLOCKED; overall qualification INCOMPLETE.\n'
