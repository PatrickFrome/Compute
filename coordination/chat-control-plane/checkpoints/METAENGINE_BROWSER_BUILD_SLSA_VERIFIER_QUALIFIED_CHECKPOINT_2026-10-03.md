# METAENGINE Browser Checkpoint — SLSA Verifier Qualified + Producer Event Fence

Date: 2026-10-03
Authority: evidence only
Promotion authority: false
Automatic retry allowed: false

## Source-only verifier line

PR #1099:
`Build: qualify exact Browser SLSA provenance evidence`

Branch:
`work/build-slsa-provenance-verifier-v1`

Exact head:
`db73c387130d80755271ed8492e5183c68fabe63`

Base:
`work/build-release-attestation-verification-v1 @ 72dec6367e89a2cbde24f3bd057e7e7eb6a320e5`

Net diff:
- `.github/workflows/browser-slsa-provenance-verifier-source-qualification.yml`
- `scripts/browser-slsa-provenance-verification.mjs`
- `tests/browser-slsa-provenance-verification.test.mjs`

No `apps/metaengine-browser/**` change exists.

## Exact-head qualification

- push run `37070014769`: SUCCESS
- pull-request run `37070117772`: SUCCESS
- 10 semantic/adversarial verifier tests: PASS
- zero-authority static contract: PASS
- unchanged source checkout: PASS

Earlier push run `37069966030` failed only in its static checker because the checker scanned its own forbidden-token literals. Unit tests were already green. The checker was corrected in source; the failed run was not rerun.

## Verifier output

The verifier emits exactly:

`metaengine.browser-fabric.provenance-evidence.v1`

with the exact key set expected by the existing release-authority gate:

- schema
- verifier_id
- verified_at
- verified
- builder_trusted
- builder_id
- source_sha
- subject_name
- subject_sha256
- predicate_type
- authority_effect

Required predicate:

`https://slsa.dev/provenance/v1`

Required build type:

`https://actions.github.io/buildtypes/workflow/v1`

It rejects:
- pull-request provenance;
- synthetic merge source SHA;
- pull merge refs;
- self-hosted runner provenance;
- builder drift;
- invocation/run drift;
- subject digest drift;
- extra resolved dependencies;
- future-dated evidence.

## Producer identity research

Default `actions/attest` provenance derives source identity from GitHub OIDC `claims.sha`.

GitHub `pull_request` runs use a synthetic merge SHA.

Current Package Smoke physically builds `github.event.pull_request.head.sha`.

Therefore default build provenance must not be produced from the current PR event topology.

Preferred P0 physical producer:
`push` on a dedicated provenance-candidate branch, where OIDC SHA and physical source SHA are identical.

## Newly discovered consumer event ambiguity

Current `installer-provenance.mjs` discovers Package Smoke runs by:

- workflow
- head SHA
- newest run number

It does not filter by event.

A later PR Package Smoke run for the same source SHA can therefore eclipse the valid push producer during initial consumer discovery.

Required P0 repair:

1. add optional exact producer event to resolver/acquire/wait;
2. filter runs by event before newest-run selection;
3. persist `producer_event` in resolved + consumer binding evidence;
4. make wait re-check exact event;
5. expose optional `ExpectedProducerEvent` in `qualified-installer-consumer.ps1`;
6. keep option optional for backward compatibility with current PR-produced physical candidate;
7. require `push` on the future SLSA physical line.

This preserves one Package Smoke workflow instead of creating a duplicate producer plane.

## Existing physical candidate remains unchanged

- source `694b106925cb7a1ce9b4d7918962821b152c0583`
- package `0.7.0-dev.37006000001.1`
- installer SHA-256 `631dc5751e9ea731d3575a3263b0d54ce264564a060133002d9f38130d7ebc14`
- Package Smoke run `37006158040` / #3149 / attempt 1
- physical matrix 10/10 SUCCESS

No new package identity has been consumed.

## Analysis line

Branch:
`analysis/build-slsa-provenance-producer-v1`

Research:
`research/BUILD_SLSA_PROVENANCE_PRODUCER_IDENTITY_RESEARCH_2026-10-03.md`

Research head before this checkpoint:
`a24254399045b88f890869dfdb40b534367b65e1`

## Next safe implementation sequence

Do not start the one-shot physical build yet.

Next source preparation should define and test the optional exact producer-event selection semantics.

The eventual physical commit should atomically contain:
- fresh unused package version;
- push producer trigger;
- producer-event resolver fence;
- default GitHub SLSA provenance generation in actual Package Smoke build job;
- portable bundle retention;
- independent read-only provenance verification;
- exact Browser Fabric provenance evidence emission.

Only then should the fresh package identity be allowed to cross the physical reservation gate.

## Hard fences

- no current installer rebuild;
- no package-version reuse;
- no retroactive/fabricated provenance;
- no duplicate Package Smoke producer;
- no release/tag/merge;
- no production Edge/DB write;
- no user-machine install/update;
- no fleet/Supervisor/Guardian/task authority;
- no blind retry.
