# UI.1 — workbench hardening checkpoint

Parent: `558a260efc9ee3f9b1fa0219b317428881407501` / PR #1083.
Branch: `work/client-v1-ui-workbench-hardening-v1`.
Candidate package identity: `0.7.0-dev.36719340135.1`.

Implemented: 90 px native chrome reservation, exact acknowledgement before actor selection, searchable fleet and compact modal picker, honest goal status/details, observation-only progress refresh, IME and double-action guards, five-area Settings with valid tools and scoped bounded reads, removal of historical source-apply UI, readable neutral tokens, keyboard focus, lazy advanced pages, local typography, strict build typing.

Local checkpoint: strict TypeScript PASS; production `next build --webpack` PASS; 81 focused Browser/UI and persistence contracts PASS; changed-component ESLint PASS. The broader local suite had 3703 passes, seven stale presentation/package assertions, one generated-file reference (restored), and ten environment-blocked IPC/listen failures. The first Linux CI run then passed 3718/3723 tests, with two expected skips and exactly three remaining stale assertions; these are corrected in the follow-up. It is not recorded as a complete local PASS. Syntax checking for the expanded Windows/Electron visual harness PASS. Local browser launch is environment-blocked and is not recorded as a pass.

Mandatory Windows visual assertions: actual native bounds equal DOM native slot and protect the goal row; narrow agent picker accessible and native view hidden under modal; Escape restores focus; stale selection acknowledgement does not change current actor; composing Enter does not submit; only one goal submission across observations; all five retained Settings destinations mount; unavailable data exits loading. Nine exact-head screenshots and the immutable installer producer are required.

Next checkpoint is terminal exact-head CI evidence and artifact readback. No production promotion, live self-update retry or C4/C5 completion is authorized by this checkpoint's existence.

First Windows readback (`efd8d65a`): strict compilation caught an unreferenced Prisma template module importing a client that clean Bun installs do not generate. The unused module is removed; strict checks stay enabled. The canonical package-identity document and the two remaining task-status assertions are aligned with the new candidate.

The first version reservation used a `.2` suffix rejected by the existing trusted update resolver. It was corrected to `0.7.0-dev.36718632888.1` at `c4838042`; the resolver contract is preserved. No installer was produced from the rejected reservation. That exact checkpoint completed all fourteen workflows successfully, including Windows install, soak and self-update. Its nine Windows screenshots were retrieved and visually reviewed.

Physical screenshot review of `c4838042` found the command palette portal outside the readable workbench styles. Follow-up applies the same typography/contrast to the portal, removes decorative SVGs and duplicate Browser navigation, restores opener focus, and keeps registry flush confirmation mounted. Windows qualification now requires actual 12px minimum/4.5:1 contrast for scope/detail text, no palette SVGs and Escape focus restoration. A higher canonical version is reserved before rebuilding.
