# METAENGINE Browser — Step 8 Electron smoke app packaging correction

Date: 2026-08-29
Branch: `work/metaengine-browser-shell-v1`

## Observation

The first isolated Development Plane entrypoint was invoked by passing a `.mjs` file directly to Electron. That new harness timed out on Linux too, even though the previous `electron . --metaengine-devplane-smoke` package entry had repeatedly passed there. The production DP code and unit contracts remained unchanged.

## Research result

Electron's documented development launch model is application-directory based: the application declares its main-process file in `package.json`, and `electron .` resolves that `main` entry. Electron's packaging documentation likewise models the application as a directory containing `package.json` plus a main file.

Sources:
- https://www.electronjs.org/docs/latest/glossary/
- https://www.electronjs.org/docs/latest/tutorial/application-distribution
- https://www.electronjs.org/docs/latest/tutorial/tutorial-first-app

## Correction

Create a minimal smoke application directory at `apps/metaengine-browser/smoke/dp/` with a tiny `package.json` whose `main` is the existing `src/development-plane-smoke.mjs`.

The physical command becomes:

`electron ./smoke/dp`

This preserves the isolated DP test while using Electron's documented app-resolution model. The smoke app contains no renderer and no extra privileges.

## Gate semantics

The physical proof still requires:
- app ready;
- utility process exact handshake;
- read-only DP0 requests;
- cooperative shutdown ACK;
- observed STOPPED state;
- process exit code zero.

No runtime authority is expanded and no Supabase checkpoint is advanced until the corrected exact-head workflow passes.
