# METAENGINE Browser — One-shot Build, Attestation and Idempotency Research

Date: 2026-10-03
Plane: research only
Authority effect: false
Physical package identity consumed by this document: none

## Scope

This note evaluates two reliability boundaries that now dominate METAENGINE Browser convergence:

1. one-shot physical package production and provenance;
2. ambiguous admission/resume effects and retry safety.

The current physical candidate is already running. Therefore every recommendation below is post-candidate unless explicitly marked as analysis-only. No source change is justified merely to adopt a nicer architecture while the current candidate is being qualified.

## External evidence

GitHub Artifact Attestations:
https://docs.github.com/en/actions/concepts/security/artifact-attestations

GitHub states that artifact attestations bind build provenance to repository, commit, workflow and triggering event, and that verification is what turns provenance into a useful policy signal. GitHub also documents that artifact attestations alone map to SLSA v1 Build Level 2.

GitHub SLSA Build Level 3 guidance:
https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/increase-security-rating

GitHub recommends moving the build into a reusable workflow and generating the attestation from that reusable workflow when targeting SLSA v1 Build Level 3.

GitHub offline attestation verification:
https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/verify-attestations-offline

GitHub supports downloading the attestation bundle and trusted roots for offline verification. This is directly relevant to an installer that must remain verifiable even when the GitHub API is unavailable.

SLSA provenance:
https://slsa.dev/spec/v1.0/provenance

SLSA frames provenance verification as checking both the artifact subject and a configured root of trust for the builder identity. Provenance by itself is evidence, not release authority.

AWS Builders' Library — Making retries safe with idempotent APIs:
https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/

AWS's core pattern is a unique caller request identifier with semantically equivalent duplicate responses. The same identifier must denote the same intent.

## What the current METAENGINE design already gets right

The present physical pipeline is stronger than a typical "build then upload" flow in several important ways:

- Package Smoke is the one installer producer.
- Downstream qualification consumes the exact Package Smoke artifact instead of rebuilding.
- source SHA, package version, workflow event and run attempt are fenced;
- package-version identity becomes consumed once physical qualification starts;
- a failed physical attempt is not rerun in place;
- a fresh source change requires a fresh package identity;
- the installer receives a real GitHub/Sigstore attestation and a separate verifier checks the exact installer digest and workflow identity;
- attestation evidence remains non-authoritative for release/promotion.

These properties should remain invariant.

## Research result A — make the builder reusable only after convergence

Moving the NSIS producer into a reusable workflow is the most direct future route from current GitHub-attested Build L2 semantics toward the GitHub-documented Build L3 architecture.

But this is not a safe pre-release refactor today. It changes the builder identity and workflow topology, so it would invalidate the exact trust root already being qualified.

Recommended sequencing:

1. finish the current candidate;
2. freeze its exact provenance as the trusted predecessor;
3. build a dedicated reusable `browser-package-producer.yml`;
4. make Package Smoke call that reusable producer;
5. pin all called actions by immutable SHA;
6. teach the verifier to trust only the reusable workflow identity plus exact caller repository;
7. qualify the migration with a non-release probe artifact before using it for the installer.

The migration should be treated as a new provenance generation, not as a transparent refactor.

## Research result B — verification policy must be explicit, not inferred

GitHub and SLSA both separate provenance from trust policy. METAENGINE should continue to verify at minimum:

- exact artifact SHA-256;
- exact repository;
- exact source commit;
- exact workflow identity;
- exact triggering event;
- deny self-hosted builders unless separately attested;
- expected package version and build identity;
- no release/promotion authority implied by attestation success.

A future verifier policy file should be machine-readable and versioned, for example:

`coordination/release/browser-build-trust-policy.v1.json`

That policy should contain the expected builder identities and accepted provenance predicates. The verifier should fail closed if a new builder appears without an explicit policy revision.

## Research result C — retain a portable offline verification packet

GitHub documents offline attestation verification using:

- the artifact;
- attestation bundle;
- trusted root;
- GitHub CLI.

METAENGINE already stores a portable attestation bundle in the candidate artifact. The next useful extension is to record enough verification metadata that an offline verifier can prove the same exact installer without network access.

Do not embed a stale trusted root forever. Instead, produce a bounded verification packet that records:

- installer digest;
- attestation bundle digest;
- trusted-root snapshot digest and acquisition timestamp;
- expected repository/workflow/source;
- verifier version;
- semantic verification result;
- authority_effect=false.

The trusted-root material itself can be distributed separately or refreshed at verification time.

## Research result D — idempotency belongs at the database transaction

The Browser's current P0 no-replay admission recovery remains correct because the server has no client-attempt idempotency key.

The AWS pattern supports the proposed V2 direction:

- the Browser creates one durable `attempt_id` before the request;
- the server stores that request identity atomically with the state transition;
- the same attempt ID with the same semantic request returns an equivalent result;
- the same attempt ID with different intent is rejected;
- only then can bounded automatic transport retry be enabled.

The idempotency record must be inside the same Postgres transaction as the generation-floor CAS. An Edge-only memory cache or Browser-only journal cannot prove exactly-once server mutation after a lost response.

## Research result E — do not conflate "retryable" with "safe to retry"

A transport timeout does not prove that no effect happened.

Future V2 should classify outcomes into:

- PRE_EFFECT_REJECTED — known no effect;
- COMMITTED — effect definitely committed;
- DUPLICATE_COMMITTED — same attempt already committed;
- DUPLICATE_REJECTED — same attempt already rejected;
- AMBIGUOUS — server result cannot be proven.

Only a stable attempt ID plus server ledger can turn the last class into a safe duplicate lookup. Until then, the current P0 automatic_retry_allowed=false is the correct policy.

## Practical next work after the active physical candidate

If the current candidate succeeds:
1. do not churn its release lineage;
2. checkpoint exact installer/provenance/matrix evidence;
3. only then consider reusable-workflow Build L3 migration and idempotent resume V2 on separate branches.

If it fails:
1. diagnose the first independent failure;
2. distinguish product defect from test/harness/topology defect;
3. fix on a new source-only successor;
4. qualify source-only;
5. allocate a new package identity;
6. never rerun the consumed physical SHA/version.

## Non-goals

This research does not authorize:
- release/tag creation;
- main merge;
- user-machine installation;
- Supabase admission mutation;
- Edge deployment;
- physical retry of a consumed source/version;
- weakening fail-close behavior.
