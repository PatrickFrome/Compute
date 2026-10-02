# npm SBOM Package Smoke source-ready checkpoint — 2026-10-02

Exact implementation source: `5d4d2981b5c1ddab4d9a3249118e596d84688b3b`  
Implementation branch: `work/build-sbom-evidence-v1`  
Qualified predecessor: `d283150bc8a3338a76b98c369b67fb7e846b207b`  
Reserved package identity: `0.7.0-dev.36991000001.1`

This checkpoint is source-only evidence. No Package Smoke physical producer has started for this package identity at checkpoint time.

## Source qualification

Browser SBOM Evidence Source Qualification #7 / run `36999438370` is terminal SUCCESS.

Jobs:
- Linux SBOM contract — SUCCESS
- Windows regression — SUCCESS

Linux:
- SBOM focused tests: 12/12 PASS
- Package Smoke SBOM wiring tests: 2/2 PASS
- two independent raw SBOM documents normalized to the same semantic inventory

Windows:
- SBOM focused tests: 12/12 PASS
- Package Smoke SBOM wiring tests: 2/2 PASS
- full Browser Node regression: **3925/3925 PASS**
- fail: 0
- skipped: 0

## Frozen dependency binding

Package version:
`0.7.0-dev.36991000001.1`

Package-lock:
- SHA-256: `d81d8d75c3facf27654e13439e005710f358705b2dde2baf6266512f45ce928b`
- bytes: 144647
- package entries: 317
- integrity entries: 317
- resolved entries: 317

Installed dependency resolution:
- SHA-256: `6a7fa9676a94bebc3d19c22396feefa1cf48a4879fbca9d5542f76a4d66da098`
- dependency count: 501
- Node: `v24.21.0`
- npm: `11.19.0`

## Stable SBOM inventory

Across Linux and Windows:
- CycloneDX 1.5
- semantic inventory SHA-256:
  `5ce48b0944a97809e8cc93de7b42b1df8ac466fb655b65da8321463019f21cf8`
- components: 286
- dependency nodes: 287
- dependency relations: 448

Raw document hashes remain intentionally non-stable because npm includes serial/timestamp metadata.

Run #7 examples:
- Linux raw #1: `e0d86ce5d9a8d3c3d128a056a515b275064221026e1b29a26fe5b2c08bb340ee`
- Linux raw #2: `c1a193ed86c70070424ed7a4cc6ff05de92842146612ceb9e32e1434d5eb2a60`
- Windows raw: `e4819f59576955dd028b3f459135ac77f6eef4bc9603b55b8e6ae98f2bb2f822`

The semantic inventory hash is the stable content identity; raw hash remains exact document evidence.

## Package Smoke integration now present

The exact source:
1. reserves one source/version before dependency install;
2. runs frozen npm ci;
3. computes installed dependency-resolution evidence;
4. generates npm CycloneDX SBOM;
5. validates exact package/version/lock/dependency bindings;
6. records semantic/raw SBOM digests in Package Smoke proof;
7. computes Build Identity V3;
8. builds one installer using locked local electron-builder;
9. carries raw SBOM + SBOM evidence into the one candidate artifact and Package Smoke evidence artifact.

The SBOM does **not**:
- enter Build Identity V3;
- grant release/promotion authority;
- request `id-token: write`;
- request `attestations: write`;
- trigger a second installer build.

## Physical qualification rule

Once draft PR creation triggers Package Smoke and the physical producer starts:
- `0.7.0-dev.36991000001.1` becomes consumed;
- do not modify source while the exact physical matrix is running;
- if any source fix is required after producer start, retire this version and advance source/version atomically;
- no blind workflow rerun.

Required physical gates:
- Package Smoke;
- Installed Chat;
- Final Runtime;
- Autonomous Soak;
- Self Update;
- Shell;
- Critical Audit;
- Dirty Profile;
- Host Resilience;
- Workspace Reincarnation.

All physical consumers must continue to consume the one exact Package Smoke artifact.

## Next architecture

After physical SBOM qualification:
- compose first-party Browser SBOM from npm inventory + ME2 UI + ME2 daemon + Guardian binaries/bootstrap;
- mark composition `incomplete`, not `complete`, until Electron/Chromium internals are exhaustively covered;
- only later introduce GitHub artifact attestation at release/promotion boundary.

No live user-machine installation or release action is authorized by this checkpoint.
