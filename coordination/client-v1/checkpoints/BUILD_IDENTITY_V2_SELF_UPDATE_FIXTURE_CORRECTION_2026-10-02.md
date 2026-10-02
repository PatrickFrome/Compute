# Build Identity V2 Self Update fixture correction checkpoint — 2026-10-02

Predecessor exact source: `2a0022d1e0119620f7badff4621cb5ff1ed5ab7c`  
Retired package identity: `0.7.0-dev.36973000001.1`  
Corrected reserved package identity: `0.7.0-dev.36974000001.1`

## Predecessor evidence

Package Smoke #3137 / run `36971539452` succeeded and physically produced:
- installer SHA-256 `28c3199c1accb761a412bca2eecfcb3e323fe74baa63fda263d7d8de0dd9893d`;
- installer bytes `159811161`;
- blockmap SHA-256 `cd9bd768e3cae62fc6870b9a9fa44e0caf8e3093d1a0091a3ef725493661f395`;
- config SHA-256 `02e569d4797baad6252f86972d0f0a87db0d0b410c1a7d80d5cc9021d9194731`;
- Build Identity SHA-256 `2e8c125f036ee27566a5857ab5c94fe65c2d400cf7ba0af1204fee4c79ae1ee1`;
- dependency-resolution SHA-256 `e37879804789c4354b0c732f2ac7a05fdfb70bf5c82a3c6849d79265200dc7f5`;
- candidate artifact `11211928176`;
- Package evidence artifact `11212390898`.

Installed Chat, Final Runtime and Autonomous Soak all passed against that exact producer artifact. Self Update contract passed, but its Windows physical job stopped in the pre-physical verifier fixture.

## Root cause

The fixture intentionally runs negative native provenance checks. The final expected rejection exits non-zero in Node; PowerShell catches the expected refusal but preserves the native `$LASTEXITCODE`. GitHub Actions then reports the step as failed even though the fixture emitted its all-pass JSON.

## Correction

`Require-Refusal` now:
- still throws on any unexpected refusal;
- clears only the `$LASTEXITCODE` associated with a matched expected negative native result;
- the fixture asserts that no stale native exit code remains before emitting success.

No production runtime logic changed.

## Identity discipline

Because the predecessor Package Smoke physically produced bytes, `0.7.0-dev.36973000001.1` is consumed and cannot be reused. The corrected source reserves `0.7.0-dev.36974000001.1`.

If any source changes after the next Package Smoke runner starts, that new identity must also be retired before another build.

## Required next evidence

- exact-head Browser regression;
- Package Smoke with one producer artifact;
- Installed Chat;
- Final Runtime;
- Autonomous Soak;
- Self Update physical E2E;
- all consumers must carry the same `build_identity_sha256` and `dependency_resolution_sha256`;
- no promotion until every required gate is terminal green.
