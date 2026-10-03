# METAENGINE Client V1 — Pre-physical R97 Source Gate Research

Date: 2026-10-03
Plane: analysis only
Physical package identity consumed by this research: none

## Purpose

The previous physical candidate consumed a package identity and failed before NSIS packaging because R97 UI behavior had not been reproduced in a source-only Windows gate. The successor adds the exact R97 ME2 visual harness before any physical Package Smoke attempt.

The gate itself exposed two Windows qualification-harness defects before a new package identity was consumed.

## Finding 1 — GUI process invocation is not a completion proof

Source run 37139602290 reached the complete R97 harness. The harness continued through:
- START_UI_HOST
- LOAD_PRIMARY_CHAT_FLEET
- POSITIVE_READINESS_READBACK
- NATIVE_COMPOSER_GEOMETRY
- SUBMIT_TYPED_GOAL
- TASK_STATUS_FOCUS
- SELECT_AGENT
- REJECT_STALE_SELECTION

The source wrapper nevertheless checked for `r85-visual-evidence.json` immediately after invoking Electron and reported `client_source_visual_evidence_missing`.

Root cause: on Windows, launching the Electron GUI executable through the PowerShell call operator did not provide the bounded process-completion barrier the wrapper assumed. The harness was still running.

Repair:
- launch Electron through `System.Diagnostics.Process`;
- use a bounded `WaitForExit(135000)`;
- fail closed on timeout/non-zero exit;
- read evidence only after terminal process exit.

This is a qualification-harness repair only. It does not add a runtime retry or installer effect.

## Finding 2 — source proof must not mutate the checkout

The next source run proved the exact R97 visual behavior successfully, including the previously failing typed goal flow.

Its final `git diff --exit-code HEAD` failed because the Windows source gate built ME2 UI in `apps/me2-ui`, and Next.js updated tracked build trace material such as:

`apps/me2-ui/.next/trace-build`

That is not a product failure. It is an invalid source-qualification topology: the qualification altered the exact checkout it was supposed to prove.

Repair:
- copy `apps/me2-ui` into `RUNNER_TEMP`;
- verify copied `bun.lock` digest equals source;
- run frozen `bun ci` in the temporary tree;
- assert `bun.lock` remains unchanged;
- build/package ME2 UI in the temporary tree;
- point the R97 harness at that isolated bundle;
- preserve the repository checkout byte-for-byte for the final exact-source assertion.

This mirrors the existing physical Package Smoke topology, which already builds the UI from a temporary copy.

## Product evidence retained

The second source attempt is important evidence even though its final source-cleanliness step failed:
- the complete Windows R97 visual flow passed;
- the original stale-readiness submit race was no longer reproduced;
- the only red condition was tracked Next.js build-trace mutation caused by the source gate itself.

A new source commit therefore fixes the gate without changing product behavior.

## Pre-physical policy

A physical branch must not move until one exact source run proves all of the following together:

1. full Browser regression on Linux;
2. full Browser regression on Windows;
3. ME2 production build;
4. complete Windows R97 visual evidence;
5. physical topology/version-reservation contract tests;
6. Windows qualified-installer consumer verification;
7. source-only permission/effect boundary;
8. exact checkout remains unchanged.

A red source run is never rerun in place. A repair gets a new commit and a new source qualification run. This does not consume a physical package identity.

## Expected payoff

This gate moves deterministic UI/harness defects left of the one-shot physical producer. It protects package-version identity, CI capacity, and the downstream ten-workflow matrix from avoidable physical fanout.
