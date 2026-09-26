# Desktop workspace integration — 2026-09-26

This increment simplifies Mission Control and connects its conversation workspace to the native desktop registry. It does not qualify the entire autonomous production loop.

## Behavior

- Five primary text navigation actions: work, tasks, code, agents, control. Additional tools remain in a labelled select and the command palette.
- Lazy page loading; one primary section initially expanded on each operational page. Secondary details use a new persisted section-state namespace.
- System fonts, reduced status bar, no KPI count animation, scanline, glow or hover-lift decoration in the application shell.
- Native conversations are listed, created, opened by chat.z.ai conversation URL, and focused through the trusted preload bridge. API session IDs are never treated as browser conversation bindings.
- Failed native registry reads remain in native mode with an explicit error. Unavailable tabs cannot be focused.
- Desktop-spawned UI explicitly disables the UI watchdog; standalone watchdog activation requires ME2_WATCHDOG=on. Child process errors are handled.
- Next build type-error suppression is disabled; existing receipt error and fallback promise type errors are corrected.

## Verification

- Production Next build succeeded with TypeScript validation (Prisma client generated before build).
- Final TypeScript no-emit check passed after native error-state adjustment.
- Desktop tests: 81 total, 80 passed, 1 physical builder-copy probe skipped.
- Desktop syntax check: 37 files passed.
- Production standalone HTTP: shell present, HTML 23,590 bytes; all 12 referenced scripts served nonempty responses.
- Visual browser verification is unavailable in this environment: agent-browser cannot bind its socket, cloud browser rejects localhost, official Chromium headless download fails archive validation. No screenshot or live Electron/provider result is claimed.

## Remaining convergence work

Legacy canonical leases, browser dispatch/CDP and supervisor execution must be integrated with the new registry before calling this a closed production loop. Packaged daemon/runtime delivery, qualified update activation/rollback, authenticated provider execution and measured learning still need implementation and live qualification. Existing refusal responses for unavailable restart/update paths are intentional.

Generated .next outputs and npm's temporary installation lock are excluded from this source change. The tracked build artifacts still need a dedicated release rebuild; source changes alone do not produce a qualified Windows installer.
