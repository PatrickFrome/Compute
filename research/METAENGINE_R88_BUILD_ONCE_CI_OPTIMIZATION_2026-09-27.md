# METAENGINE R88 — Build-Once Consumer CI Deduplication

Date: 2026-09-27  
Branch: `work/r88-consumer-ci-dedup-v1`  
Parent: R87 visual-isolation slice

## Objective

Continue the R86 immutable-installer architecture after physical CI proved that Installed Chat, Final Runtime, and Autonomous Soak can consume the Package Smoke artifact rather than rebuilding NSIS independently.

R88 removes work that became semantically dead once the installer became the immutable build product.

## Finding

All three downstream consumers still rebuilt/staged `apps/me2-ui` before waiting for the Package Smoke artifact:

- Installed Chat: build + pack + copy + verify ME2 UI.
- Final Runtime: Setup Bun plus a fail-open ME2 UI build/stub path.
- Autonomous Soak: build + pack + copy + verify ME2 UI.

Those staged directories are not used to construct the acquired installer. Downstream physical verification reads the ME2 bundle from the installed Package Smoke bytes. Keeping the source-side UI build therefore duplicated producer work, consumed Windows runner time, and created a second failure surface unrelated to the immutable artifact being qualified.

## R88 implementation

- Removed the redundant ME2 UI build/stage block from Installed Chat.
- Removed obsolete Setup Bun and the old fail-open C7 UI build/stub path from Final Runtime.
- Removed the redundant ME2 UI build/stage block from Autonomous Soak.
- Preserved source parsing, detached physical capture, activation contracts, soak harness parsing, immutable artifact acquire/verify, installation, and installed-bundle readback.
- Broadened consumer path triggers so UI/daemon-only producer changes still launch downstream qualification:
  - `apps/me2-ui/**`
  - `apps/me2-daemon/**`
  - exact installer-provenance script where the previous selective trigger needed it.
- Added topology regression assertions forbidding UI rebuilds in the three consumers.
- Added a redirect regression proving Actions-style artifact download follows the temporary redirect while the bearer token is not forwarded to the redirected origin.
- Added fail-fast classification for permanent GitHub Actions API 4xx responses so a permissions/configuration defect cannot consume the full 45-minute polling budget.

## Invariants

- Package Smoke remains the only R86/R88 NSIS producer.
- Consumers install and qualify the exact bytes named by `installer-provenance.json`.
- Exact source SHA remains mandatory.
- Installer, blockmap, and electron-builder config hashes remain mandatory.
- A failed Package Smoke run cannot be converted into downstream success.
- No production promotion, Browser command, scheduler, update, or release authority is added.
- Network/transient failures may retry only inside the bounded poll budget; permanent API rejection fails closed immediately.

## Expected effect

The current R86 physical run demonstrates why this matters: consumers complete their source checks and then spend substantial wall time on ME2 UI builds before waiting at the immutable-artifact acquire boundary. R88 removes those serial/duplicated UI builds. Exact time savings will be measured only from physical R88 CI; no performance claim is accepted before that run.

## Next slice

After R86 and R87 are terminal-green, open R88 as a stacked qualification PR. A later slice may reduce the remaining producer/consumer serialization by publishing the immutable candidate immediately after package construction and allowing downstream work to overlap the producer's long installed/Sentinel proof, while still requiring the same producer run to finish successfully before any consumer can become green.
