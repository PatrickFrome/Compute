# Stream 05 — W77 source-signing and sidecar handoff audit (2026-11-01)

Status: **source-only hardening; production signing and placement BLOCKED**.
Scope: `PatrickFrome/Compute`, base `9c8345cfc787f3ff810792b761bb49570d6d31d8` (#1395); no main merge, final package build, version reservation, credential creation, host installation, or trust-root change.

## Real route and authority boundary

| Boundary | Actual source or retained bytes | Outcome / missing interface |
| --- | --- | --- |
| Packaged Browser tree → external inventory | `scripts/electron-builder-after-all-artifact-build.cjs` invokes `writePackagedCodeInventoryW77`; `metaengine-installed-package-code.v1.json` is outside the final installer | Source producer implemented; final prepackage EXE and tree must still be qualified on the exact physical build |
| Final NSIS bytes → GitHub artifact and attestation | `.github/workflows/browser-windows-package-smoke.yml`: exact-source candidate ZIP, provenance bundle/receipt; `scripts/release-proof-producer-w77.mjs` pins artifact ID, digest, size, run/attempt, full ZIP membership | Workflow currently labels NSIS build **unsigned** and `signed=false`; immutable GH artifact and independent `gh attestation verify` must be freshly executed on Windows custody host |
| EXE integrity / code / builder | W77 independent GH verification and semantic verifier; `readWindowsSignedExecutableW60` before/after; `verifyPackageCodeW68` for full tree; stable physical-file checks | Neither semantic `verified:true` nor producer receipt is cryptographic attestation; signed Authenticode EXE and real linked tree remain unqualified |
| Existing Ed25519 release-root manifest bytes | `serializeReleaseManifestW77`: domain `METAENGINE_INSTALLED_RELEASE_MANIFEST_V2\u0000` + JSON of exactly ten ordered v2 properties, hashes of EXE, final installer, bundle, evidence, code inventory | Fixed snapshot drift/accessor/re-read defect in this branch; unchanged W68 verification domain/key |
| Protected signer result | `createReleaseRootSigningRequestW77` emits transport only; added `parseUntrustedReleaseSignerResultW77` for exact-byte parsing of *proposed* result v1 | **No authenticated protected signer invocation** or real Ed25519 release-root signature. Parser explicitly reports `signer_invocation_authenticated:false` and `cryptographic_signature_verified:false`. Never promote parse success to authority |
| Four external sidecars → installed EXE siblings | `build/installer.nsh` has fresh-install shutdown gate but no four-file placement; `scripts/install-package-bounded.ps1` only has installer path/SHA/timeout | **No authenticated sidecar delivery implementation**, existing activation hold/restart/partial-placement readback authority or physical install receipt |
| Installed file-readback → executable authority | `src/installed-executable-provenance-w68.mjs` reads exact four siblings and checks existing root signature, W60 two native OS observations and package-tree equality | Consumer exists, yet cannot succeed from missing signer/placement; its observation does not by itself certify native loaded-code custody, Guardian enrollment, clean-machine readiness |

## Immutable binary topology — no circular hash

1. **Prepackage EXE / unpacked Browser tree:** inventory records exact relative files, byte lengths and SHA-256, including executable resources. Release manifest references prepackage EXE SHA-256 and the inventory SHA-256.
2. **Final installer:** built after the prepackage tree is fixed. Calculate its SHA-256 only after all packaging changes. The final installer MUST NOT embed a manifest that names its own finalized hash.
3. **After final installer digest:** independently acquire and check immutable artifact ID, whole original ZIP digest and member bytes, SLSA evidence, signer/builder policy and two signed-EXE reads. Request signature over the unchanged W68 domain and ten-field manifest.
4. **Four detached sidecars:** `metaengine-installed-release-proof.v2.json` (Ed25519-signed envelope), `installer-slsa-provenance.bundle.json`, `browser-package-slsa-provenance-evidence.json`, `metaengine-installed-package-code.v1.json`; delivered outside the final installer byte closure. Their exact bytes/digests belong to a separately authenticated, immutable delivery object; never change a pinned candidate ZIP.
5. **Fresh install only:** a privileged, authenticated installer/placement owner must select the canonical installed root and hold activation; validate ancestor namespace, ACL/ownership, no preexisting targets, exact packaged tree; exclusive-create fixed names, flush, read back identities/digests, and run the real W68 Host/Guardian readback. Partial/ambiguous install is not ready or safely retryable merely because a write returned successfully.

## Specific defects reproduced and corrected

- **Accessor drift in signing bytes:** previously each manifest field could be read twice, once during validation and again for serialization. An accessor returning different valid source SHA values made the signed bytes inconsistent with checked input; non-enumerable and Symbol fields silently bypassed the exactness guard. `snapshotReleaseManifestW77` now requires an exact own enumerable data-property set, captures field values once, and validates exactly the captured copy.
- **Handoff re-read drift:** after manifest validation, `createExternalReleaseProofHandoffW77` previously re-read potentially hostile source, package and installer fields. It now uses the same independently validated snapshot for all handoff fields.
- **External signer-result syntax without implying custody:** new `parseUntrustedReleaseSignerResultW77` rejects duplicate/unknown/out-of-order fields, non-canonical UTF-8 JSON/base64, invalid signature lengths, false-to-true authority substitutions, wrong algorithm, malformed implementation revision and invocation identity. This is only a parser; a caller-provided request or result cannot authenticate itself, prove real signing, or authorize placement. No envelope-emitting production API was introduced.

Source test cases were first run against the defective code (RED), then against fixes (GREEN). All signer-result signature bytes in tests are inert fixtures.

## Production provisioning proposal — decision inputs for the owner

Owner must **first** identify whether the existing Ed25519 release-root private signing capability and approved policy already exist, with an SPKI matching the unmodified packaged `build/emergency-maintenance-public-key.pem`. A development root or historical PR is not production key-custody evidence. Public OpenSSL certificate input is a distinct crypto-build dependency, not this key and not Windows Authenticode.

Consider an **existing** vendor/HSM protected signer, an **existing** organization custody service, or a **reviewed** protected CI signing execution with equivalent narrowly scoped secret access. Compare before selection: immutable implementation/policy revision; actual principal and authentication; key public SPKI fingerprint (nonsecret); allowlisted `sign_installed_release_manifest_v2` operation and exact source/workflow/run/artifact constraints; replay/timeout outcomes; immutable request/result retention; protected upload and physical sidecar-placement mechanism; bounded rollback/partial readback; independently witnessed Windows Authenticode certificate issuance and actual native signature. No procurement, registration, keys or credentials are undertaken in this stream.

If the existing root private key is unavailable or unapproved, **stop**. Producing a new private key, rewriting W68 key pin, or treating the development root as production requires separately owned policy and approval; this task does not do it. Required independent owner approvals: signer custody/policy, Authenticode issuance and use, production release signing event, delivery placement and activation policy, real clean-machine installation and effects.

## Test / install mode classification

`emitStagingReleaseProofW77` and `verifyStagingInstalledExecutableW68` use explicitly disposable test-root/reader inputs and remain `STAGING`. `electron-builder.test.json` is the current Windows package recipe, not a demonstrated isolated installer mode that admits a complete signed, installed and running METAENGINE without production custody. No such mode was located along the inspected W77/NSIS/package path. Do not install a GUI mock or bypass Defender/SmartScreen/Authenticode and call that a successful client.

## Remaining dependencies for coordinator

- Release custody owner: exact existing signer invocation/principal, implementation revision, approved public SPKI pin, real authenticated result and immutable audit chain; otherwise **BLOCKED**.
- Installer owner (#1399 / coordinator): reviewed fixed sidecar placement, fresh-only namespace + ACL check, activation hold, exclusive atomic placement, partial/restart recovery and independent W68/native readback.
- Package owner: complete relative Codex CLI and Git executable/dependency role contract; real bundled Guardian, Browser, PostgreSQL 17 and OS baseline closure.
- Crypto owner (#1424): real Windows/MSVC static-crypto build + linked native readback; external public OpenSSL certificate does not solve Ed25519 custody.
- Coordinator: ancestry reconciliation of independently based PRs, source freeze, exact artifact SHA/version, fresh Windows clean-target qualification, successful enrollment, controlled-failure rollback and final acceptance, with UNKNOWN/SKIP kept distinct from PASS.

No production signing service, protected placement, Windows clean-target installation, final installer signing, actual GPT/Codex account enrollment or post-reboot runtime-readback was performed by this stream.
