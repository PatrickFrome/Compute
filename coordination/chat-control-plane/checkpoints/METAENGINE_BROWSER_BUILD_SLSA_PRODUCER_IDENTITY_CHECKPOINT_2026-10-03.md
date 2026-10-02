# METAENGINE Browser Checkpoint — SLSA Producer Identity Boundary

Date: 2026-10-03
Authority: evidence only
Promotion authority: false
Automatic retry allowed: false

## Existing qualified lines

Release-attestation verification:
- PR #1098
- branch `work/build-release-attestation-verification-v1`
- exact head `72dec6367e89a2cbde24f3bd057e7e7eb6a320e5`
- source qualification push `37065847144`: SUCCESS
- source qualification PR `37065851353`: SUCCESS

Physical Browser subject remains:
- source `694b106925cb7a1ce9b4d7918962821b152c0583`
- package `0.7.0-dev.37006000001.1`
- installer SHA-256 `631dc5751e9ea731d3575a3263b0d54ce264564a060133002d9f38130d7ebc14`
- Package Smoke producer `37006158040` / #3149 / attempt 1
- physical matrix 10/10 SUCCESS

No new physical package was built in this research slice.

## New blocking identity finding

Default GitHub SLSA provenance uses OIDC `claims.sha` as the resolved source `gitCommit`.

On `pull_request`, GitHub defines `GITHUB_SHA` as the synthetic merge commit and `GITHUB_REF` as `refs/pull/<n>/merge`.

METAENGINE Package Smoke explicitly builds `github.event.pull_request.head.sha`.

Therefore default SLSA provenance generated in the existing pull-request producer would bind a different source commit than the physical Build Identity / installer.

This must not be papered over with a custom SLSA predicate.

## P0 architecture decision

Future physical SLSA Package Smoke must run from an event whose OIDC SHA is the physical source SHA.

Preferred event:
`push` on a dedicated provenance-candidate branch.

The eventual physical rollout must also suppress a duplicate PR Package Smoke build for that same fresh package identity.

## Safe source-only next step

Created implementation branch:

`work/build-slsa-provenance-verifier-v1`

from exact:
`72dec6367e89a2cbde24f3bd057e7e7eb6a320e5`.

Implement a root-level, source-only SLSA semantic verifier + tests + isolated source qualification.

Do not touch:
- `apps/metaengine-browser/**`;
- Package Smoke workflow;
- package version;
- physical release workflows.

This lets the expected predicate shape become executable before any new one-shot physical package is consumed.

## Research branch

`analysis/build-slsa-provenance-producer-v1`

Research document:
`research/BUILD_SLSA_PROVENANCE_PRODUCER_IDENTITY_RESEARCH_2026-10-03.md`

## Hard fences

- no retroactive SLSA provenance for current installer;
- no consumed package version reuse;
- no custom/fabricated SLSA predicate;
- no second physical producer;
- no release/tag/merge;
- no production Edge/DB write;
- no user-machine update/install;
- no fleet/Supervisor/Guardian/task authority;
- no blind retry.
