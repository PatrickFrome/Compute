#!/usr/bin/env bash
# Reviewed-source prerequisite only: production materializer/physical setup handoff UNBOUND.
# Existing pinned dependencies and disposable own PostgreSQL17; no install/network.
set -euo pipefail
cd "$(dirname "$0")/../../.."
: "${METAENGINE_PG_TEST_BIN:?Existing PostgreSQL17 bin directory required}"
: "${METAENGINE_PG_TEST_DRIVER:?Existing postgres 3.4.7 driver required}"
out="${METAENGINE_CAPACITY_V2_LOG_DIR:-$(mktemp -d /tmp/metaengine-capacity-v2-default.XXXXXX)}"
mkdir -p "$out"
node --test --test-reporter=tap --test-concurrency=1 \
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
node --test --test-reporter=tap --test-concurrency=1 \
 apps/metaengine-browser/test/native-coding-host-ipc.test.mjs \
 apps/metaengine-browser/test/native-host-scope-cleanup.test.mjs \
 infra/client-state-runtime/native-coding-preparation-transaction.test.mjs \
 infra/client-state-runtime/native-coding-device-request.test.mjs \
 infra/client-state-runtime/native-coding-capacity-source.test.mjs > "$out/lifetime.tap" 2>&1
node --test --test-reporter=tap --test-concurrency=1 \
 infra/client-state-runtime/native-coding-capacity.pg17.test.mjs \
 infra/client-state-runtime/native-coding-service-admission.integration.test.mjs \
 infra/client-state-runtime/native-coding-setup.pg17.test.mjs > "$out/pg17.tap" 2>&1
LOCAL_STATE_TEST_PROJECT_PG_BIN_DIR="$METAENGINE_PG_TEST_BIN" METAENGINE_MIGRATION_TEST_LOG="$out/full-migration.pg.log" \
 node --test --test-reporter=tap infra/client-state-runtime/local-runtime-migrations.integration.test.mjs > "$out/full-migration.tap" 2>&1
(cd apps/metaengine-browser && node scripts/check-source.mjs) > "$out/source.log" 2>&1
node --check apps/metaengine-browser/test/native-coding-capacity-first-dispatch.test.mjs
node --check infra/client-state-runtime/native-coding-capacity.pg17.test.mjs
git diff --check;git diff --cached --check
for log in components.tap lifetime.tap pg17.tap full-migration.tap;do tail -9 "$out/$log";done
cat "$out/source.log"
printf 'Default v2 admission SOURCE checkpoint only. No installed/native or autonomous next-task acceptance.\n'
printf 'Materializer, setup physical handoff and historical joined-settlement producer UNBOUND.\n'
printf 'Required separate socket lane BLOCKED; UI dependency lane FAIL/BLOCKED; overall qualification INCOMPLETE.\n'
