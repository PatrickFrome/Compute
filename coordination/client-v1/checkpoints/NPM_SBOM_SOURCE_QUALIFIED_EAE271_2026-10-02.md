# npm SBOM source qualification — 2026-10-02

Qualified source: `eae271e1eaa6a3d790cfdf872c639a2b2569f45a`  
Implementation branch: `work/build-sbom-evidence-v1`  
Qualification run: Browser SBOM Evidence Source Qualification #6 / `36998959402`

This checkpoint is evidence-only. It does not authorize release, promotion, live installation, Guardian enrollment, Supervisor admission, task execution, or automatic physical retry.

## Result

Both source-qualification jobs are SUCCESS:

- Linux SBOM contract — SUCCESS
- Windows regression — SUCCESS

## Frozen dependency material

Package:
- version: `0.7.0-dev.36991000001.1`
- package-lock SHA-256: `d81d8d75c3facf27654e13439e005710f358705b2dde2baf6266512f45ce928b`
- package-lock bytes: **144647**
- lockfileVersion: **3**
- lockfile package entries: **317**
- entries with integrity: **317**
- entries with resolved source: **317**

Installed dependency tree:
- dependency count: **501**
- dependency-resolution SHA-256: `6a7fa9676a94bebc3d19c22396feefa1cf48a4879fbca9d5542f76a4d66da098`
- Node: `v24.21.0`
- npm: `11.19.0`

## npm CycloneDX semantic inventory

Linux generated two independent `npm sbom --sbom-format=cyclonedx --sbom-type=application` documents.

Raw document digests differed, as expected:
- first raw SBOM SHA-256: `916cfa8031fe51087d7b68b0c3e62812c2962a5342cc331f1d54741572321320`
- second raw SBOM SHA-256: `ee754dc8ee392507b9f4bf02d68552146f3827f6cebe507b91855d183b369a48`

Both normalized to the same semantic inventory:
- semantic inventory SHA-256: `5ce48b0944a97809e8cc93de7b42b1df8ac466fb655b65da8321463019f21cf8`
- component count: **286**
- dependency graph nodes: **287**
- dependency relations: **448**
- CycloneDX spec: **1.5**
- root type: application
- serial number present: true
- metadata timestamp present: true
- authority effect: false

This proves the intended split:
- raw SBOM bytes are document evidence and may vary because npm emits volatile document metadata;
- semantic inventory is the stable dependency-content identity.

## Windows proof

Windows produced:
- raw SBOM SHA-256: `63043b683348091ceb31ff773b1a5c2d0cd2c018a5e33c1b2f463142c1f982e5`
- the **same semantic inventory SHA-256**:
  `5ce48b0944a97809e8cc93de7b42b1df8ac466fb655b65da8321463019f21cf8`
- component count: **286**
- dependency nodes: **287**
- dependency relations: **448**

The Windows PowerShell UTF-8 BOM boundary is explicitly covered. The parser accepts a standard UTF-8 BOM while preserving the exact raw-byte SHA.

## Tests

SBOM focused tests:
- **12/12 PASS** on Linux
- **12/12 PASS** on Windows

Full Browser Windows Node regression:
- **3923/3923 PASS**
- fail: 0
- skipped: 0

## Safety properties

The SBOM evidence:
- binds exact package name/version;
- binds exact package-lock SHA;
- binds exact installed dependency-resolution SHA;
- binds npm version;
- binds source SHA when supplied;
- requires CycloneDX;
- requires application root;
- rejects package/version/toolchain drift;
- has `authority_effect=false`.

It is intentionally **not** added to Build Identity V3 because npm's raw SBOM document contains volatile metadata and is generated post-install.

## Next implementation

The next safe slice is to add the npm SBOM + semantic evidence to the one-built Package Smoke producer:

1. generate it after frozen `npm ci` and dependency-resolution proof;
2. verify lock/dependency/root bindings;
3. preserve raw SBOM + semantic evidence in Package Smoke candidate/evidence;
4. do not rebuild the installer;
5. do not grant promotion/release authority from SBOM presence alone.

Composed Browser SBOM research is maintained separately on:
`analysis/build-composed-sbom-v1`.
