# METAENGINE Browser Checkpoint — First SLSA Physical Candidate Activated

Date: 2026-10-03
Authority: evidence only
Promotion authority: false
Automatic retry allowed: false

## Activation commit

Prepared source-only physical topology:
`work/build-slsa-physical-prep-v1 @ d45b0f0b8d40320f4b0c3ad5646541ecccf73d46`

Source qualification:
`37075932409` — SUCCESS

A new package identity was then created as a Git object before the physical branch existed.

Activation commit:
`b8f2f438bf3d9450a301ebb525eb95181f6d464d`

Parent:
`d45b0f0b8d40320f4b0c3ad5646541ecccf73d46`

The activation commit changes exactly:
- `apps/metaengine-browser/package.json`
- `apps/metaengine-browser/package-lock.json`

Fresh package version:
`0.7.0-dev.37076000001.1`

Both package.json and the package-lock root version agree exactly.

The physical branch did not exist before this commit was created.

## Atomic branch activation

Created:

`physical/build-slsa-provenance-v1`

directly at:

`b8f2f438bf3d9450a301ebb525eb95181f6d464d`

There was no intermediate branch state pointing at the already-consumed package version.

This intentionally started the first SLSA-qualified physical Browser matrix.

## Physical matrix runs

Exact source:
`b8f2f438bf3d9450a301ebb525eb95181f6d464d`

Package:
`0.7.0-dev.37076000001.1`

Runs, all attempt 1:

- Browser Windows Package Smoke — `37076381698` / #3155
- Browser Windows Installed Chat Qualification — `37076381669` / #2433
- METAENGINE Browser Final Runtime Activation V1 — `37076381678` / #2014
- METAENGINE Browser Windows Autonomous Soak V1 — `37076381723` / #2685
- METAENGINE Browser Self Update E2E — `37076381646` / #3604
- METAENGINE Browser Shell V1 — `37076381699` / #3556
- METAENGINE Browser Critical Audit V1 — `37076381653` / #2609
- METAENGINE Browser Shell-First Dirty Profile V1 — `37076381677` / #1042
- METAENGINE Browser Host Resilience Login Start V1 — `37076381725` / #519
- Browser Workspace Reincarnation V1 — `37076381700` / #571

At checkpoint creation:
- Host Resilience — SUCCESS
- Workspace Reincarnation — SUCCESS
- the remaining physical workflows were running or waiting on Package Smoke.

## Package Smoke identity gate

Package Smoke run:
`37076381698`

Preflight job:
`111067121610`

Result:
SUCCESS

Preflight checked out exact:
`b8f2f438bf3d9450a301ebb525eb95181f6d464d`

and exposed package identity:
`0.7.0-dev.37076000001.1`.

The Windows producer job:
`111067166630`

started on attempt 1.

At this checkpoint it had entered the frozen toolchain stage. The source/version reservation and physical build steps had not yet been reported terminal.

## Physical retry rule

From this point forward this source/version pair must be treated as a one-shot physical candidate.

Do not rerun Package Smoke.

If the producer fails after the package reservation boundary:
- do not reuse source SHA;
- do not reuse package version;
- advance both source and version before any new physical attempt.

Downstream consumers must remain bound to:
- exact source;
- exact producer event `push`;
- exact producer run id/number/attempt;
- one-built immutable installer artifact.

## Expected new evidence

The Package Smoke producer is expected to create on the exact physical push:

- Build Identity V3
- frozen npm/Bun dependency material
- npm CycloneDX SBOM
- composed Browser SBOM
- installer provenance
- GitHub OIDC-backed SLSA provenance
- portable Sigstore bundle
- `metaengine.browser.package-slsa-provenance-receipt.v1`
- independently verified `metaengine.browser-fabric.provenance-evidence.v1`
- existing Browser/Guardian physical package evidence

SLSA attestation is evidence only and grants no release/promotion authority.

## Hard fences

- no workflow rerun;
- no second installer producer;
- no release/tag/merge;
- no production Edge/DB write;
- no user-machine install/update;
- no fleet/Supervisor/Guardian/task authority;
- no inference of qualification until all exact-source physical workflows are terminal SUCCESS.
