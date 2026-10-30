#!/usr/bin/env bash
# Read-only custody/default-composition checkpoint; NOT v2 effect admission.
# Uses existing fixture dependencies and disposable own PG17 only.
set -euo pipefail
cd "$(dirname "$0")/../../.."
: "${METAENGINE_PG_TEST_BIN:?Existing PostgreSQL17 bin directory required}"
: "${METAENGINE_PG_TEST_DRIVER:?Existing postgres 3.4.7 driver entrypoint required}"
out="${METAENGINE_CAPACITY_READ_LOG_DIR:-$(mktemp -d /tmp/metaengine-capacity-read-custody.XXXXXX)}"
mkdir -p "$out"
node --test --test-reporter=tap --test-concurrency=1 \
 apps/metaengine-browser/test/native-coding-capacity-owner.test.mjs \
 apps/metaengine-browser/test/native-coding-capacity-contract.test.mjs \
 apps/metaengine-browser/test/native-coding-service-heartbeat-publisher.test.mjs \
 apps/metaengine-browser/test/native-coding-execution-pool.test.mjs \
 apps/metaengine-browser/test/native-coding-runtime.test.mjs \
 apps/metaengine-browser/test/client-native-coding-goal.test.mjs \
 infra/client-state-runtime/native-host-startup-lifecycle.test.mjs \
 infra/client-state-runtime/native-coding-host-capacity.test.mjs \
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
(cd apps/metaengine-browser && node scripts/check-source.mjs) > "$out/source.log" 2>&1
node --check apps/metaengine-browser/test/native-coding-capacity-owner.test.mjs
node --check infra/client-state-runtime/native-coding-host-capacity.test.mjs
git diff --check;git diff --cached --check
for log in components.tap lifetime.tap pg17.tap; do tail -9 "$out/$log";done
cat "$out/source.log"
printf 'READ-ONLY custody prerequisite, not shared effect admission; v2 SQL remains unregistered.\n'
printf 'Materializer and historical joined-settlement producer UNBOUND; global qualification INCOMPLETE.\n'
