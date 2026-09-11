# METAENGINE Browser — Step 6 Windows runner diagnostic

Date: 2026-08-29
Branch: `work/metaengine-browser-shell-v1`

## Proven state

At exact head `4a2c899a529efe399fa2f24d90b1253ba6d9fac5`, Linux again passed the full shell contract and physical Development Plane smoke, while `windows-latest` timed out before emitting any application stdout or stderr. The preserved Windows artifact contained the exact Git head but empty `metaengine-dp-out.txt` and `metaengine-dp-err.txt`.

This falsifies the hypothesis that the remaining timeout is caused solely by Development Plane shutdown. The failure occurs before a usable application receipt is observed on that hosted Windows environment.

## Research

GitHub currently maps `windows-latest` to Windows Server 2025. The runner-images project has documented 2026 Electron-related regressions on Server 2025 images. Electron's own CI guidance states that Windows Electron testing does not require an Xvfb-style virtual display. Therefore we should separate a stable required Windows host proof from a rolling latest-image compatibility canary instead of allowing an opaque `windows-latest` host issue to define the product contract.

Sources:
- https://github.com/actions/runner-images
- https://github.com/actions/runner-images/issues/14174
- https://www.electronjs.org/docs/latest/tutorial/testing-on-headless-ci

## Decision

1. Required physical Windows Development Plane proof runs on pinned `windows-2022`.
2. `windows-latest` remains a parallel experimental compatibility canary; its evidence is always uploaded and its failure is visible but does not erase a valid pinned-Windows proof.
3. Both variants record `ImageOS`, `ImageVersion`, and matrix identity.
4. Chromium startup logging is enabled for the diagnostic command and GPU is disabled because DP0 does not exercise renderer graphics.
5. The product security contract is not relaxed: physical process exit, `ok=true`, and `shutdown.state=STOPPED` remain mandatory on the required Windows runner.

## Interpretation rule

A green workflow proves DP0 on Linux plus Windows Server 2022 and records current `windows-latest` compatibility separately. It does not by itself claim final Windows 10/11 release certification. That remains a later native release/canary milestone.
