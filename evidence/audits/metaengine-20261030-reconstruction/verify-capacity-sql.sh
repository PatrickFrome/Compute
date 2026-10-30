#!/usr/bin/env bash
# Unregistered SOURCE/SQL prerequisite only. Existing dependencies + own PG17.
# No production materializer/wiring, install/download, public write or PC effect.
set -euo pipefail
cd "$(dirname "$0")/../../.."
: "${METAENGINE_PG_TEST_BIN:?Point to existing PostgreSQL17 bin directory}"
: "${METAENGINE_PG_TEST_DRIVER:?Point to existing postgres JS driver entrypoint}"
out="${METAENGINE_CAPACITY_SQL_LOG_DIR:-$(mktemp -d /tmp/metaengine-capacity-sql-verification.XXXXXX)}"
mkdir -p "$out"
node --test --test-reporter=tap --test-concurrency=1 \
 apps/metaengine-browser/test/native-coding-service-heartbeat-publisher.test.mjs \
 apps/metaengine-browser/test/native-coding-capacity-contract.test.mjs \
 infra/client-state-runtime/native-coding-capacity-source.test.mjs > "$out/components.tap" 2>&1
node --test --test-reporter=tap --test-concurrency=1 \
 infra/client-state-runtime/native-coding-capacity.pg17.test.mjs \
 infra/client-state-runtime/native-coding-service-admission.integration.test.mjs \
 infra/client-state-runtime/native-coding-setup.pg17.test.mjs > "$out/pg17.tap" 2>&1
(cd apps/metaengine-browser && node scripts/check-source.mjs) > "$out/source.log" 2>&1
for file in apps/metaengine-browser/src/native-coding-capacity-contract.mjs \
 apps/metaengine-browser/test/native-coding-capacity-contract.test.mjs \
 infra/client-state-runtime/native-coding-capacity-source.test.mjs \
 infra/client-state-runtime/native-coding-capacity.pg17.test.mjs; do node --check "$file"; done
git diff --check;git diff --cached --check
tail -9 "$out/components.tap";tail -9 "$out/pg17.tap";cat "$out/source.log"
printf '4 new-file syntax checks and diff checks PASS; logs: %s\n' "$out"
printf 'UNREGISTERED prerequisite only; no production v2 producer/default sharing or native qualification.\n'
printf 'Overall qualification incomplete: dependency FAIL/BLOCKED, required socket BLOCKED, Windows UNKNOWN, publication gated.\n'
