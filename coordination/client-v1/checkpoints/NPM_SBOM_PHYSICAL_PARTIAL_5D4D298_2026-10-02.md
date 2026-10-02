# npm SBOM physical qualification partial checkpoint — 2026-10-02

Exact source: `5d4d2981b5c1ddab4d9a3249118e596d84688b3b`  
Draft PR: #1095  
Package identity: `0.7.0-dev.36991000001.1`

## Physical qualification started

Creating draft PR #1095 triggered the exact-head physical matrix.

Current Package Smoke:
- run #3146
- run id `36999900075`
- `package_identity_preflight`: SUCCESS
- Windows NSIS producer job: queued at checkpoint time

Other exact-head workflows triggered:
- Critical Audit #2604
- Self Update #3599
- Installed Chat #2428
- Autonomous Soak #2680
- Shell #3551
- Host Resilience #516
- Final Runtime #2011
- Dirty Profile #1039
- Workspace Reincarnation #568

## Identity discipline

Because the official Package Smoke run has started, `0.7.0-dev.36991000001.1` is now treated as **consumed**.

From this point:
- do not modify `work/build-sbom-evidence-v1` while the matrix runs;
- no blind rerun;
- if a source fix becomes necessary, retire this package identity and advance source/version atomically before the next physical producer.

## Pre-physical source proof

Exact source had already passed Browser SBOM Evidence Source Qualification #7 / run `36999438370`:
- Linux SBOM contracts: SUCCESS
- Windows SBOM contracts: SUCCESS
- full Windows Browser Node suite: 3925/3925 PASS
- stable semantic inventory SHA:
  `5ce48b0944a97809e8cc93de7b42b1df8ac466fb655b65da8321463019f21cf8`

Frozen dependency material:
- package-lock SHA `d81d8d75c3facf27654e13439e005710f358705b2dde2baf6266512f45ce928b`
- installed dependency-resolution SHA `6a7fa9676a94bebc3d19c22396feefa1cf48a4879fbca9d5542f76a4d66da098`
- dependency count 501
- Node v24.21.0
- npm 11.19.0

## Next evidence gate

Wait for the one official Package Smoke producer.

If it succeeds:
1. record installer SHA/bytes/blockmap/config/provenance/Build Identity V3;
2. record physical npm SBOM raw + semantic digests;
3. require candidate artifact to contain SBOM + evidence;
4. require every downstream physical consumer to reverify the same producer artifact;
5. require Self Update to pass exact resident replacement;
6. seal terminal qualification checkpoint.

No release, promotion or live user-machine installation is authorized.
