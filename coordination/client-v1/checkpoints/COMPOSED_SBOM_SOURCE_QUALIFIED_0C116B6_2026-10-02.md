# Composed Browser SBOM source qualification — 2026-10-02

Exact source: `0c116b613053e4b55b30633704d050abfecb2174`  
Implementation branch: `work/build-composed-sbom-v1`  
Qualification workflow: Browser Composed SBOM Source Qualification #1 / run `37000279803`

## Result

Linux contract: SUCCESS  
Windows contract: SUCCESS

Focused composed-SBOM tests:
- tests: **5**
- pass: **5**
- fail: **0**
- skipped: **0**

## Implemented composition model

New generator:
`apps/metaengine-browser/scripts/composed-sbom-evidence.mjs`

It consumes:
- npm CycloneDX SBOM + stable npm evidence;
- ME2 UI bundle manifest;
- ME2 daemon package manifest;
- Guardian native staging manifest;
- Guardian machine-bootstrap binding;
- installer provenance v3;
- exact source SHA and package version.

It produces:
- CycloneDX 1.5 composed Browser SBOM;
- machine-readable zero-authority evidence;
- stable composed semantic inventory SHA.

## Current first-party assembly coverage

The composed Browser root includes:
- Browser npm inventory;
- ME2 UI;
- ME2 daemon;
- Guardian service;
- Guardian configurator;
- Guardian machine bootstrap.

The composition is explicitly:
`aggregate: incomplete`

This is intentional: Electron/Chromium internals and OS-provided components are not yet exhaustively decomposed, so the implementation refuses to claim complete coverage.

## Cross-binding contracts

The generator fail-closes on:
- source SHA drift;
- package-version drift;
- npm package-lock/dependency-resolution mismatch vs installer provenance;
- ME2 UI source mismatch;
- daemon source mismatch;
- authority-bearing daemon manifest;
- Guardian source/version mismatch;
- Guardian service activation authority;
- Guardian binary cardinality/name/hash errors;
- machine-bootstrap service/configurator digest mismatch;
- installer provenance v3 mismatch.

Guardian/daemon authority remains false.

## Determinism semantics

The root installer is identified by installer SHA-256 from provenance.

First-party component refs are deterministic and digest-bound.

The semantic composed inventory is canonicalized independently from raw document serialization so document-level metadata can remain evidence without masquerading as reproducible content identity.

## Scope boundary

This source-only work is on a separate successor branch. It does not modify the active npm-SBOM physical qualification source `5d4d2981…` and does not affect package identity `0.7.0-dev.36991000001.1`.

Do not integrate the composed SBOM into Package Smoke until the active npm-SBOM physical matrix is terminally qualified.

No release, attestation, promotion, live installation, Guardian enrollment, Supervisor admission or task effect is authorized.
