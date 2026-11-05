# Apply and qualify (source-only)

Input: METAENGINE-agent-count-free-tools-source.zip, SHA256 3d10cdc8c7801870cd33b5bed1f9b8efee1bb597fd412f401407fec7d247e68a. Recreate a disposable Git index preserving Unix modes and verify `git write-tree` equals 01ff1f13e9a8723f7d631c075ea49f55d51ed405.

`git apply --check AGENT_TOOLBELT_RETIREMENT_CORE.patch` then `git apply AGENT_TOOLBELT_RETIREMENT_CORE.patch`.

Run `node --test --test-concurrency=1 apps/metaengine-browser/test/agent-toolbelt.test.mjs apps/metaengine-browser/test/agent-toolbelt-concurrency.test.mjs apps/metaengine-browser/test/agent-toolbelt-long-run-audit.test.mjs apps/metaengine-browser/test/agent-toolbelt-lease-retirement.test.mjs` for the core-only qualification.

Shared owner integration ONLY after coordination: `git apply --check INTEGRATION_TASK_CYCLE.patch`, `git apply INTEGRATION_TASK_CYCLE.patch`. Then run `node --test --test-concurrency=1 apps/metaengine-browser/test/agent-toolbelt-lease-retirement-integration.test.mjs apps/metaengine-browser/test/devos-native-task-cycle.test.mjs`. The integration task-cycle file is owned by a separate ongoing stream. No dispatcher durable-journal edits.

Physical PostgreSQL, Windows, installed app, services and installer: NOT RUN.
