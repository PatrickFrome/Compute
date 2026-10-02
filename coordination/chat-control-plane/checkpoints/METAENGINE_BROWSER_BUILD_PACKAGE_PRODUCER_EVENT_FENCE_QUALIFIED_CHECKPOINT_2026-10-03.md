# METAENGINE Browser Checkpoint — Package Producer Event Fence Qualified

Date: 2026-10-03
Authority: evidence only
Promotion authority: false
Automatic retry allowed: false

## Implementation

Branch:
`work/build-package-producer-event-fence-v1`

Exact head:
`ebc8db27304b06e8e08163b04498726d9201785d`

Base:
`work/build-slsa-provenance-verifier-v1 @ db73c387130d80755271ed8492e5183c68fabe63`

Changed files:
- `.github/workflows/browser-package-producer-event-fence-source-qualification.yml`
- `apps/metaengine-browser/scripts/installer-provenance.mjs`
- `apps/metaengine-browser/scripts/qualified-installer-consumer.ps1`
- `apps/metaengine-browser/test/installer-provenance.test.mjs`
- `apps/metaengine-browser/test/qualified-installer-consumer-contract.test.mjs`

Package version remains:
`0.7.0-dev.37006000001.1`

Package Smoke workflow is unchanged.

No physical Package Smoke run was started by this branch.

## Exact producer-event contract

`installer-provenance.mjs` supports optional:

`--event push|pull_request|workflow_dispatch`

When supplied:

- list-workflow-runs query includes both exact `head_sha` and `event`;
- returned rows are also locally filtered by exact SHA + event;
- `resolved.json` persists `producer_event`;
- Wait rechecks the exact run's event;
- mismatch fails with `producer_event_mismatch`.

The GitHub REST API officially supports both `event` and `head_sha` filters for this endpoint.

## Shared consumer contract

`qualified-installer-consumer.ps1` adds optional:

`-ExpectedProducerEvent`

Allowed:
- `push`
- `pull_request`
- `workflow_dispatch`

When set:
- Acquire forwards exact event;
- resolved evidence must match it;
- consumer binding carries `producer_event`;
- Wait forwards and re-verifies exact event;
- terminal proof carries the event.

When omitted, legacy behavior remains available for the already-qualified PR-produced physical candidate.

## Qualification

Source qualification workflow:
`Browser Package Producer Event Fence Source Qualification`

Run `37070756887`:
- parser PASS
- implementation/unit tests PASS
- static checker FAILED because its expected schema literal used underscores instead of the actual canonical hyphenated schema
- no physical effect occurred
- run was not rerun

Checker source was corrected.

Exact final head run:
`37070823699` — SUCCESS

Passed:
- Node parse
- PowerShell parse
- hermetic installer provenance suite
- shared qualified-installer consumer contract suite
- zero-authority/source-only static boundary
- exact checkout unchanged

## SLSA verifier predecessor

PR #1099:
`Build: qualify exact Browser SLSA provenance evidence`

Exact head:
`db73c387130d80755271ed8492e5183c68fabe63`

- push qualification `37070014769`: SUCCESS
- PR qualification `37070117772`: SUCCESS
- draft/open/mergeable
- no physical Browser fan-out

## Physically-qualified candidate unchanged

- source `694b106925cb7a1ce9b4d7918962821b152c0583`
- package `0.7.0-dev.37006000001.1`
- installer SHA-256 `631dc5751e9ea731d3575a3263b0d54ce264564a060133002d9f38130d7ebc14`
- Package Smoke `37006158040` / #3149 / attempt 1
- physical matrix 10/10 SUCCESS

No new package identity was consumed.

## Next safe frontier

The prerequisites for a physical SLSA producer are now source-qualified:

1. exact GitHub-generated SLSA semantic verifier;
2. exact producer-event discovery fence;
3. one-built Package Smoke consumer topology;
4. package reservation/no-rerun fence;
5. Build Identity V3 + composed SBOM binding.

Do not open a PR from the event-fence branch because its product-path changes would trigger physical Browser workflows against the already-consumed package version.

Before the first physical SLSA run, prepare one atomic candidate line with:
- fresh unused package version;
- exact push event identity;
- build-time default GitHub SLSA provenance in the real Package Smoke producer;
- portable bundle retained in immutable candidate;
- downstream independent read-only verification with `ExpectedProducerEvent=push`;
- full physical matrix consuming the same one-built bytes.

## Hard fences

- no current installer rebuild;
- no consumed package-version reuse;
- no retroactive/fabricated provenance;
- no second Package Smoke producer workflow;
- no blind retry;
- no release/tag/merge;
- no production Edge/DB write;
- no user-machine install/update;
- no fleet/Supervisor/Guardian/task authority.
