# METAENGINE Browser composed SBOM architecture research — 2026-10-02

Analysis base: `eae271e1eaa6a3d790cfdf872c639a2b2569f45a`  
Qualified V3 predecessor: `d283150bc8a3338a76b98c369b67fb7e846b207b`  
Active npm-SBOM implementation: `work/build-sbom-evidence-v1`

This is research-only. It introduces no release, promotion, installation, Guardian, Supervisor or task authority.

## Why npm SBOM alone is incomplete

The Browser installer contains more than the Browser npm dependency graph.

Current package/build evidence shows distinct first-party/native payloads:
- METAENGINE Browser / Electron shell;
- ME2 UI standalone bundle;
- ME2 daemon executable;
- Guardian service executable;
- Guardian configurator executable;
- Guardian machine-bootstrap payload;
- installer/blockmap itself.

`npm sbom` accurately covers the npm graph of `apps/metaengine-browser`, but it does not describe all those bundled payloads.

Therefore the npm SBOM must be treated as **one constituent inventory**, not the final installer SBOM.

## CycloneDX completeness rule

CycloneDX explicitly supports composition completeness values including:
- `complete`;
- `incomplete`;
- `incomplete_first_party_only`;
- `incomplete_third_party_only`;
- `unknown`.

Primary source:
https://cyclonedx.org/guides/sbom/frontispiece/

METAENGINE must not mark the composed Browser inventory `complete` until all known embedded first-party payloads and relevant third-party runtime components are represented.

The first composed SBOM should therefore use:
`aggregate: incomplete`

This is materially better than overclaiming completeness.

## Existing evidence sources to compose

### Browser npm layer

Source:
- npm CycloneDX SBOM;
- `package_lock_sha256`;
- `dependency_resolution_sha256`;
- npm version;
- stable semantic inventory digest.

The raw SBOM includes volatile timestamp/serial metadata; the semantic inventory digest intentionally excludes those document-level values.

### ME2 UI

Existing manifest:
`me2.ui-bundle-manifest.v1`

Available identity evidence:
- `ui_version`;
- Next BUILD_ID;
- source `git_sha`;
- bundle `size_bytes`;
- existing `content_sha256`.

The UI manifest has a volatile `built_at`, so the composed SBOM should bind the UI component to the existing content digest / installed verification evidence rather than hash the raw manifest bytes as a reproducibility claim.

The UI dependency graph is separately frozen by:
- Bun `1.3.3`;
- exact `apps/me2-ui/bun.lock` SHA.

### ME2 daemon

Existing manifest:
`metaengine.browser.me2-daemon-package.v1`

Available identity evidence:
- exact source SHA;
- daemon version;
- Bun build version;
- compiled `me2-daemon.exe` SHA-256;
- executable size;
- runtime-embedded true;
- no external Bun runtime required;
- probe-only / read-only authority properties.

The daemon executable hash is suitable as direct CycloneDX component integrity evidence.

### Guardian native staging

Existing staging/installed evidence binds:
- `METAENGINEBrowserGuardian.exe` SHA-256 + size;
- `METAENGINEBrowserGuardianConfigure.exe` SHA-256 + size;
- exact source SHA;
- Browser package version;
- staging-only;
- service activation unauthorized.

Those two binaries should be first-class `application` components with SHA-256 hashes.

### Guardian machine bootstrap

Package Smoke already emits an independently hashed bootstrap executable and binding proof.

It should be a distinct component because it is an executable artifact with a separate digest and authority boundary.

### Browser installer subject

The installer itself remains the final artifact subject:
- filename;
- SHA-256;
- bytes;
- source SHA;
- package version;
- Build Identity V3;
- provenance v3.

Do not make the installer depend on its own BOM component in a circular graph. Treat the installer as metadata/root subject, with embedded components represented beneath it.

## Recommended component IDs

Use deterministic bom-ref identifiers, never random UUIDs for first-party payloads:

- `metaengine:browser:<version>`
- `metaengine:browser:npm:<semantic_inventory_sha256>`
- `metaengine:me2-ui:<version>:<content_sha256>`
- `metaengine:me2-daemon:<version>:<exe_sha256>`
- `metaengine:guardian-service:<sha256>`
- `metaengine:guardian-configurator:<sha256>`
- `metaengine:guardian-bootstrap:<sha256>`

For npm packages retain their package URLs emitted by npm.

## Dependency/assembly geometry

Root:
`METAENGINE Browser <package_version>`

Assemblies:
- Browser npm inventory
- ME2 UI
- ME2 daemon
- Guardian service
- Guardian configurator
- Guardian bootstrap

The npm inventory keeps its own transitive dependency graph.

The other embedded payloads are assembly edges, not npm dependency edges.

## Coverage statement

First composed SBOM:
- Browser npm graph: represented;
- Browser first-party embedded binaries/resources listed above: represented;
- full Electron/Chromium internal component inventory: **not yet exhaustively decomposed**;
- OS/runtime-provided components: not represented.

Therefore:
`composition.aggregate = incomplete`

Future work may improve coverage without changing Build Identity.

## Evidence semantics

CycloneDX allows component hashes and identity evidence. METAENGINE should use SHA-256 for direct binary/bundle identity whenever available.

Primary sources:
- https://cyclonedx.org/use-cases/integrity-verification/
- https://cyclonedx.org/guides/sbom/evidence

Rules:
- never synthesize a hash from a filename;
- never use a mutable path as component identity;
- prefer existing verified SHA-256 readbacks;
- preserve source SHA/package version as properties;
- preserve authority-boundary properties for Guardian/daemon rather than collapsing them into a generic “binary present” claim.

## Proposed artifact

`metaengine-browser-composed.cdx.json`

Schema level:
CycloneDX 1.5 initially, matching npm's current output and current npm tooling.

Document metadata:
- component = METAENGINE Browser package/version;
- source SHA property;
- Build Identity V3 property;
- package-lock SHA property;
- dependency-resolution SHA property;
- Bun/UI-lock properties;
- installer provenance id property.

Composition:
- aggregate `incomplete`;
- assemblies = deterministic first-party component refs.

## Determinism policy

Like npm SBOM, the raw composed BOM document may include timestamp/serial metadata.

Store both:
1. raw composed SBOM SHA-256;
2. stable canonical inventory SHA-256 excluding document-level volatility.

Do not put raw SBOM SHA inside Build Identity V3.

## Package Smoke integration order

After npm-SBOM source qualification is green:

1. npm ci
2. package-lock/dependency proof
3. npm SBOM + npm semantic inventory
4. ME2 UI build + manifest
5. ME2 daemon compile + manifest
6. Guardian native staging + bootstrap evidence
7. electron-builder
8. installer provenance
9. composed SBOM assembly using all already-produced manifests
10. candidate/evidence upload

The composed SBOM is a byproduct of the exact physical producer. It must not trigger a second installer build.

## Attestation boundary

GitHub recommends attesting binaries that users will run/release and not frequent test-only builds.

Primary source:
https://docs.github.com/en/actions/concepts/security/artifact-attestations

Therefore:
- ordinary draft Package Smoke: generate/store composed SBOM, no attestation;
- release-candidate/published-release workflow: attest exact qualified installer and optionally the composed SBOM.

Attestation remains downstream of all physical qualification gates.

## Next implementation slice

1. finish npm SBOM source qualification;
2. integrate npm SBOM into Package Smoke evidence;
3. create a composed-SBOM generator that only consumes existing manifests/proofs;
4. unit-test missing/tampered component hashes fail closed;
5. physically qualify one-built installer with composed SBOM evidence;
6. only then implement release-boundary attestation.
