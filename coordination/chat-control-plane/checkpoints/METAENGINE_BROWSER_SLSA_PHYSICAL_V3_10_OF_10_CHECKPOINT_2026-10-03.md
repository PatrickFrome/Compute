# METAENGINE Browser Checkpoint — SLSA Physical V3 Terminal 10/10

Date: 2026-10-03
Authority: evidence only
Promotion authority: false
Automatic retry allowed: false

## Frozen exact candidate

Physical branch:
`physical/build-slsa-provenance-v1`

Exact source:
`a68774eb6ad5a0fe8014501163b0c67f608bed09`

Package:
`0.7.0-dev.37086632570.1`

Source preparation branch:
`work/build-slsa-physical-fix-v3`

Exact source qualification:
`37087134491` — SUCCESS

Platforms:
- Ubuntu 24.04 — SUCCESS
- Windows 2025 — SUCCESS

The source qualification proved:
- shared consumer PowerShell parse;
- local `Mode Verify` under simulated physical push without implicit event drift;
- consumer contract tests;
- complete Browser Node regression;
- package/version/convergence reservation consistency;
- zero physical/release authority;
- exact checkout unchanged.

## Why V3 was needed

Consumed predecessor:

`c80e0fb46dc8c701462beb7f74dd8ff45867ac74`
/
`0.7.0-dev.37084599153.1`

That predecessor reached 9/10 physical workflow families.

Self Update failed before installer acquisition/effect because ambient physical push context auto-inferred `ExpectedProducerEvent=push` for local `Mode Verify`, then PowerShell StrictMode rejected an intentionally absent `producer_event` on the synthetic verification fixture.

V3 confines automatic event selection to remote producer operations:
- Acquire
- Wait

Verify remains local/branch-agnostic unless the caller explicitly supplies an event.

A first versioned V3 source also exposed stale canonical reservation text in `CONVERGENCE_CANDIDATE.md`. Linux and Windows full regressions rejected it before physical activation. The canonical reservation and qualification path coverage were then corrected atomically.

No package build occurred on those rejected source-only heads.

## Terminal physical matrix

Every physical workflow below ran on exact source
`a68774eb6ad5a0fe8014501163b0c67f608bed09`,
attempt 1, and is terminal SUCCESS.

- Package Smoke — `37087347663` / #3157
- Installed Chat Qualification — `37087347662` / #2435
- Final Runtime Activation — `37087347653` / #2016
- Autonomous Soak — `37087347631` / #2687
- Self Update E2E — `37087347623` / #3606
- Shell — `37087347652` / #3558
- Critical Audit — `37087347661` / #2611
- Shell-First Dirty Profile — `37087347656` / #1044
- Host Resilience Login Start — `37087347640` / #521
- Workspace Reincarnation — `37087347643` / #573

Physical matrix result:
`10/10 SUCCESS`

No workflow rerun was used.

## One-built exact installer

Installer:
`METAENGINE-Browser-Test-Setup-0.7.0-dev.37086632570.1-x64.exe`

SHA-256:
`937936bc51d431540762d170b7cc970fdfe1575b9879b885efdc22089e3f2455`

Bytes:
`156364268`

Package Smoke:
`37087347663 / #3157 / attempt 1`

Package Smoke candidate artifact:
- id `11260817954`
- digest `sha256:5ec7ff9c36329504cdc46d0f5fa2023720e7e1637e8731b28537768abfcec4f6`

Package-version reservation:
- id `11261231922`
- digest `sha256:e48a265f111ba0e5ba97ff5e2407efcc477e4e76e6b324333705d01e9d3d1138`

Package evidence:
- id `11261117931`
- digest `sha256:917bc78714528dc26e744efab8cb96d814d291929f7d4b7990b3893161d8c69d`

## Build / dependency / SBOM identity

Build Identity V3:
`f7d78fdaf7b89028341cc4d0ceb7a7f73ead9b3a323fc15d1560563d7d0c478c`

Dependency resolution:
`e099165be494af2f8d16a3e5b7d675fcbbe369f16bebf16ce182cf8bb7dfcb09`

Package lock:
`4f4fb5e3d6f44d9dc9dfd55054fb2aed8845a83de82a013727b45ea9d0f52059`

Node:
`v24.21.0`

npm:
`11.19.0`

Bun:
`1.3.3`

Electron Builder:
`26.15.7`

Composed semantic inventory:
`cce189f978bc27d0175b2a431ebb4f771f05a0fa334d3d95af1390363f4b176c`

Composition aggregate:
`incomplete`

The incomplete aggregate remains deliberate truthful SBOM evidence, not an error masked as complete coverage.

## GitHub SLSA provenance

Attestation:
`52339986`

Exact subject:
`METAENGINE-Browser-Test-Setup-0.7.0-dev.37086632570.1-x64.exe@sha256:937936bc51d431540762d170b7cc970fdfe1575b9879b885efdc22089e3f2455`

Independent verifier:
`metaengine.browser-fabric.provenance-evidence.v1`

Verified fields:
- `verified=true`
- `builder_trusted=true`
- builder = Package Smoke workflow on exact physical branch
- source SHA = exact candidate SHA
- subject SHA = exact installer SHA
- predicate = `https://slsa.dev/provenance/v1`
- `authority_effect=false`

SLSA verification artifact:
- id `11261401099`
- digest `sha256:6614a8fa2ccd358bbe1d423845912578d6a194c997eeb736a6222fd610d20331`

## Self Update closure

Self Update:
`37087347623 / #3606 / attempt 1` — SUCCESS

It acquired the existing Package Smoke installer and did not build another target.

Resident upgrade proof:
- legacy version `0.7.0-dev.34759310781.1`
- target version `0.7.0-dev.37086632570.1`
- target installer SHA `937936bc51d431540762d170b7cc970fdfe1575b9879b885efdc22089e3f2455`
- installer exit `0`
- legacy primary gone = true
- legacy Sentinel gone = true
- new primary started = true
- new Sentinel started = true
- planned shutdown verified = true
- retry dialog required = false
- installed executable hash exact = true
- authority effect = false

Self Update evidence artifact:
- id `11261575777`
- digest `sha256:04dab9a9035ce9f27535d049f321d231cf3cb81a8316238db652049751f03fe6`

Terminal producer gate:
- producer run `37087347663`
- run number `3157`
- attempt `1`
- event `push`
- exact Build Identity V3
- exact dependency/lock/toolchain material
- `producer_terminal_success=true`
- `authority_effect=false`

## Installed qualification

Supabase project:
`jhriwwsryeqsvvvufkok`

Function:
`metaengine-client-installed-qualification-h205f22`

Deployment:
version `8`

Deployment id:
`jhriwwsryeqsvvvufkok_add28328-d282-4942-9fa1-c2302da1e23f_8`

The predecessor physical Installed Chat run proved the bounded physical push path in Edge logs:
- exact qualification request first returned HTTP 202 waiting;
- the bound successor request returned HTTP 200 approval.

The final a687 Installed Chat workflow is also terminal SUCCESS.

## Result

P0 supply-chain convergence is physically closed for this exact candidate:

exact source
→ one-shot package reservation
→ frozen dependencies
→ one NSIS producer
→ Build Identity V3
→ npm/composed SBOM
→ installer provenance V3
→ GitHub OIDC SLSA
→ Sigstore/Rekor
→ portable bundle
→ independent verifier
→ one immutable candidate
→ exact event-fenced consumers
→ 10/10 physical matrix
→ successful resident Self Update using the same target bytes.

## What this does not prove

This checkpoint does NOT authorize or claim:
- GitHub Release/tag publication;
- promotion to production authority;
- merge into a canonical release branch;
- installation/update on the user's physical machine;
- Guardian enrollment on the user's machine;
- Supervisor admission or task dispatch;
- real z.ai Agent-origin useful-work completion;
- end-to-end task result provenance in the user's live Browser.

Those remain separate acceptance/effect boundaries.

## Next frontier

Freeze this candidate as the P0 supply-chain evidence baseline.

Next research:
1. reusable vetted builder workflow for stronger isolated builder identity / SLSA Level 3 direction;
2. product acceptance for real z.ai Agent-origin task → execution → verified result;
3. release/publisher integration that consumes this exact evidence without rebuilding.

Any live user-machine installation remains behind explicit authorization.
