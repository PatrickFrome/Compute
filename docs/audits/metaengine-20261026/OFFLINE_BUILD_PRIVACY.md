# Explicit UI build upgrade policy — 2026-10-26

Separate source change after the orphan-removal commit
`9730b397d26be7146901e967eddb61623480d201`.

The denied build's registry request was not Prisma installation. Installed Next
16.4.1 source defaults `experimental.agentUpgrade` to `"security"`
(`next/dist/server/config-shared.js`). Its build runner starts a background
`nudgeUpgrade` (`next/dist/build/index.js`), whose upgrade assessment can call
the npm bulk advisory endpoint (`next/dist/lib/upgrade/prepare-upgrade.js`).
That policy is separate from telemetry; `NEXT_TELEMETRY_DISABLED=1` alone does
not make this operation offline.

The supported `experimental.agentUpgrade: false` setting is now explicit in
`apps/me2-ui/next.config.ts`. With no explicit upgrade request, the installed
build source skips the background assessment, and both `assessUpgrade` and
`nudgeUpgrade` return before network calls. The change removes the unwanted
transmission; it does not redirect it, change networking permissions, spoof a
response, disable dependency integrity, or suppress the recorded findings.
Explicit audit/upgrade commands and frozen-lock checks remain available and
require their existing authorization. No app/dependency version changed.

`scripts/offline-build-config.test.mjs` loads the actual effective production
configuration, verifies the disabled policy and calls the installed assessment
and nudge functions with an instrumented failing `fetch`. It asserts **zero
fetch calls**, rather than merely matching source text. The subprocess clears
only the explicit upgrade-request variable for this implicit-request test.
The production configuration does not erase an owner's explicit environment
request.

Typecheck, lint and **70 UI/security/config tests pass**. The previous denied
build remains unverified and is not counted as a pass. One revised build of this
committed configuration is authorized; its terminal outcome and local package
proof belong in `/workspace/shared/metaengine-ui-prisma-evidence/` under the
`revised-offline-*` names. A nonterminal log alone is not successful verification.
No new registry audit or install is part of that build verification.

This is C2 source/build reproducibility and privacy evidence, not installed
Windows/runtime qualification or a release authorization.

## Terminal revised-build evidence

At source commit `0e661cb83c7a360ecfd1f99d1acf0a50c8b036a2`, the single revised
build returned **exit 0**, followed by successful postbuild, pack and static
bundle verification. Build ID: `AbPYarscf4r3UXtIo0k3F`; the bundle is bound to that
exact source SHA and contains **1,254 content-verified files**. Its package
manifest contains no Prisma dependency or removed database script, and retains
`pg`. The verifier records `runtime_smoke: NOT_RUN`.

The earlier denied operation was not resumed. No registry audit or install was
retried. Local receipts are `revised-offline-{build,postbuild,pack}.exit`,
`revised-offline-bundle-verification.txt` and `revised-offline-summary.json` in
the evidence directory above. This documentation-only addendum does not claim a
new artifact for its own commit.
