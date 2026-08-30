# METAENGINE Browser self-update supervisor takeover — 2026-08-30

Status: ACTIVE DEVELOPMENT CHECKPOINT

## Live state verified

- The currently installed METAENGINE Browser reports `0.6.3-dev.77.1`.
- Native supervisor remains in `CONTROL` with ARM preserved.
- A fresh typed `SELF_UPDATE_STATUS` issued from the successor ChatGPT supervisor session was leased and completed by the live browser.
- The self-update runtime remains in `DISCOVERY_ERROR` with `trusted_release_dev_yml_sha256_mismatch`.
- The verified dev release `0.6.3-dev.78.1` is discoverable and has the expected four release assets.

## Root cause

The 77.1 trusted release resolver verifies GitHub asset SHA-256 after calling `response.text()`. A UTF-8 BOM in `dev.yml` is consumed by text decoding, so the hash of the re-encoded string differs from the GitHub digest of the raw release bytes.

## Recovery slice

Branch: `work/self-update-raw-metadata-integrity-v1`

Baseline: `f66414918abbac8b53d2dac3e9a2352d5d94a8e8`

Implemented:

1. Verify trusted metadata SHA-256 over exact response bytes before any text decoding.
2. Decode verified metadata with fatal UTF-8 semantics.
3. Preserve strict structural and installer bindings after decoding.
4. Add regression coverage for UTF-8 BOM and digest-valid malformed UTF-8.
5. Generate physical E2E `dev.yml` as UTF-8 without BOM and fail the build if `EF BB BF` is present.

## Compatibility objective

The next physically proven development release must carry BOM-free `dev.yml`. This lets the already-installed 77.1 verify the next release using its legacy string-hash resolver, while the successor version carries the corrected raw-byte verifier for all future releases.

## Safety invariants

- No `main` merge in this checkpoint.
- No mutation of the already-published 78.1 release.
- No direct production authority promotion.
- No blind retry after ambiguous effects.
- Executable and blockmap promotion remain gated on exact physical N→N+1 evidence.
- Page-derived data has zero development authority.
