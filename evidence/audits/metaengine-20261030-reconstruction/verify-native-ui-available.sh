#!/usr/bin/env bash
# AVAILABLE source checks only. Not full qualification: required dependency
# security and identity-delegation socket lanes are separately FAIL/BLOCKED.
# Reuse existing tools only; no install/download or native/public effects.
set -euo pipefail
cd "$(dirname "$0")/../../.."
out="${METAENGINE_NATIVE_UI_LOG_DIR:-$(mktemp -d /tmp/metaengine-native-ui-verification.XXXXXX)}"
mkdir -p "$out"
METAENGINE_DRAFT_NAMESPACE_LOG_DIR="$out/native" bash evidence/audits/metaengine-20261030-reconstruction/verify-draft-namespace.sh
node --test --test-reporter=tap --test-concurrency=1 apps/me2-ui/src/lib/*.test.mjs > "$out/ui-source.tap" 2>&1
node --test --test-reporter=tap --test-concurrency=1 apps/me2-ui/scripts/ui*.test.mjs \
 apps/me2-ui/scripts/offline-build-config.test.mjs apps/me2-ui/scripts/runtime-cache-config.test.mjs > "$out/ui-fixtures.tap" 2>&1
(cd apps/me2-ui && node node_modules/eslint/bin/eslint.js .) > "$out/lint.log" 2>&1
git diff --check; git diff --cached --check
tail -9 "$out/ui-source.tap"; tail -9 "$out/ui-fixtures.tap"
printf 'Available checks completed; logs: %s\n' "$out"
printf 'NOT full qualification: dependency-security remains FAIL/BLOCKED; identity-delegation socket lane remains BLOCKED.\n'
# Required unchanged command once an exact independently authorized frozen
# dependency toolchain exists (not run against the known-failing cache again):
# node --test apps/me2-ui/scripts/dependency-security.test.mjs
