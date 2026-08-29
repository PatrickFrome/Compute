# METAENGINE Browser TEST Windows Installer

Date: 2026-08-29
Branch: `work/metaengine-browser-test-console-v1`
Authority effect: false

## Goal

Produce a single Windows x64 installer executable for METAENGINE Browser TEST 0.5.0-test.1 with a user experience comparable to mainstream desktop applications: double-click setup, per-user install without administrator rights, desktop and Start Menu shortcuts, run-after-install, and standard Windows uninstall registration.

## Packaging

- Electron: 44.0.0
- Builder: electron-builder 26.15.7 (pinned in CI invocation)
- Target: NSIS x64
- Mode: one-click, per-user
- `appId`: `com.metaengine.browser.test`
- `asar=false` so the Development Plane utility-process worker remains a normal filesystem entry rather than relying on archive execution semantics.
- Browser user data is not deleted by uninstall by default.

## Safety invariants

Packaging does not grant new Browser, Development Plane, sandbox execution, multi-gateway dispatch, or promotion authority. Existing parse/tests and the physical Windows Development Plane smoke must pass before the installer is built.

The test installer is intentionally unsigned until a trusted Authenticode signing identity is provisioned. Windows SmartScreen may therefore warn about an unknown publisher. This is packaging provenance debt, not execution authority.

## Installer verification

CI must:

1. run parse and contract tests;
2. run physical Windows Development Plane smoke;
3. build one NSIS `.exe`;
4. compute SHA-256 and record source HEAD;
5. perform a silent installation smoke and locate the installed browser executable;
6. upload the installer and receipt.
