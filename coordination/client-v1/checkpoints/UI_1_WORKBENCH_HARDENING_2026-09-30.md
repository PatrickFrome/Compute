# UI.1 — workbench hardening checkpoint

Parent: `558a260efc9ee3f9b1fa0219b317428881407501` / PR #1083.
Branch: `work/client-v1-ui-workbench-hardening-v1`.
Candidate package identity: `0.7.0-dev.36686651354.2`.

Implemented: 90 px native chrome reservation, exact acknowledgement before actor selection, searchable fleet and compact modal picker, honest goal status/details, observation-only progress refresh, IME and double-action guards, five-area Settings with valid tools and scoped bounded reads, removal of historical source-apply UI, readable neutral tokens, keyboard focus, lazy advanced pages, local typography, strict build typing.

Local checkpoint: strict TypeScript PASS; production `next build --webpack` PASS; 81 focused Browser/UI and persistence contracts PASS; changed-component ESLint PASS. The broader local suite had 3703 passes, four stale presentation assertions (now corrected), one generated-file reference (restored), and thirteen environment-blocked IPC/listen failures. It is not recorded as a complete local PASS. Syntax checking for the expanded Windows/Electron visual harness PASS. Local browser launch is environment-blocked and is not recorded as a pass.

Mandatory Windows visual assertions: actual native bounds equal DOM native slot and protect the goal row; narrow agent picker accessible and native view hidden under modal; Escape restores focus; stale selection acknowledgement does not change current actor; composing Enter does not submit; only one goal submission across observations; all five retained Settings destinations mount; unavailable data exits loading. Nine exact-head screenshots and the immutable installer producer are required.

Next checkpoint is terminal exact-head CI evidence and artifact readback. No production promotion, live self-update retry or C4/C5 completion is authorized by this checkpoint's existence.
