# SYNC Evidence Bundle v1 — H205F22

Status: PREPARED / non-authority

## Purpose

`SYNC-L4.8` packages a completed synchronous-development barrier into a byte-stable evidence artifact and, after promotion to trusted `main`, cryptographically attests that artifact with GitHub Artifact Attestations / Sigstore.

An evidence signature is evidence about bytes and workflow identity. It is **not** project authority, a canonical checkpoint, a W1 persistent-worker proof, or permission to merge.

## Historical interpretation rule

Completed historical barriers are immutable facts bound to the validator implementation that produced them.

Policy: `NO_RETROACTIVE_REINTERPRETATION`.

For `SYNC-L4.7-002`, the frozen completion is bound to:

- source commit `f7067c353f319d01b88efa1d83aa691d9d6d5bd1`;
- execution subject `0bce991dc5db90a4d515d0ccae9bb696cc345a69d0df958e0db719a68112152b`;
- peer barrier `f1b6532b6f80c3cbb721f286dbb61b1954d960a501c81e9b5b7a86723f1c4164`;
- exact Git blob identities of the v2 barrier and both persisted-review ingestors.

The bundle builder recomputes Git blob identity from the **actual local validator file bytes** before it accepts historical evidence. Merely carrying the expected blob SHA as metadata is insufficient. Any validator-byte drift fails closed and requires a new receipt/migration path.

A future incompatible schema major version must create a new receipt. It must not reinterpret or overwrite the old completed barrier.

## Bundle inputs

The deterministic builder accepts only credential-free validated evidence:

1. exact composite execution subject;
2. persisted GitHub↔AppVeyor cross-provider readback;
3. ChatGPT persisted GitHub-review ingest receipt;
4. GLM persisted PAP-review ingest receipt;
5. completed GPT↔GLM peer-review barrier.

The builder fails closed unless:

- cross-provider evidence is `CROSS_PROVIDER_REPRODUCED_VERIFIED`;
- AppVeyor identity comes from persisted artifact bytes;
- both review roots match the completed barrier;
- reviewer identity sources are the expected persisted channels;
- both dispositions are `ACCEPT`;
- blocking HIGH/CRIT findings are zero;
- all subject/task/epoch/source/tree/contract/result roots match;
- the historical barrier matches its frozen validator binding;
- the currently executed validator bytes reproduce every frozen Git blob SHA;
- all authority fields remain false.

## Deterministic archive

Archive name: `h205f22-sync-l47-002-evidence.tar`.

Members are sorted and normalized (`mtime=0`, `uid=0`, `gid=0`, mode `0644`) so independent builders produce identical bytes.

Members:

- `execution-subject.json`
- `cross-provider-readback.json`
- `chatgpt-ingest.json`
- `glm-ingest.json`
- `barrier.json`
- `schema-version-policy.json`
- `evidence-statement.json`
- `manifest.json`

The external bundle receipt records the tar SHA-256 and manifest SHA-256.

## Internal statement

The bundle contains an in-toto Statement-v1-shaped document:

- `_type = https://in-toto.io/Statement/v1`
- subject digest = exact execution-subject SHA-256
- predicate type = Metaengine sync-evidence v1
- predicate records review roots, identity sources, validator binding, schema policy and non-authority scope.

The internal statement is descriptive evidence included in the tar. The GitHub attestation step signs the **tar artifact** using GitHub's standard SLSA build-provenance mode rather than treating the internal predicate as project authority.

## Attest then verify

Trusted-main workflow performs two separate steps:

1. pinned `actions/attest` attests the deterministic tar with GitHub OIDC / Sigstore-backed SLSA build provenance;
2. `gh attestation verify <tar> -R PatrickFrome/Compute` independently verifies the resulting attestation against the repository identity.

A successful attest call without a successful downstream verification is not sufficient for `ATTESTED_EVIDENCE_READY_NON_AUTHORITY`.

## Security boundary

Live evidence collection / attestation:

- is `workflow_dispatch` only on `refs/heads/main`;
- uses a protected GitHub environment;
- keeps top-level workflow permissions read-only;
- grants `id-token: write`, `attestations: write`, and `artifact-metadata: write` only to the live job;
- reads GLM PAP data without ACK/publish mutations;
- keeps the PAP bearer out of curl header arguments/process argv;
- removes raw provider responses before artifact upload;
- uploads only credential-free derived evidence.

Pull-request jobs run deterministic tests only and never execute the live attestation job.

## Evidence classes

Before merge / live attestation:

`PREPARED / CI_VALIDATED / NOT_LIVE_ATTESTED`

After a trusted-main attestation **and** successful cryptographic verification:

`ATTESTED_EVIDENCE_READY_NON_AUTHORITY`

Always false for this layer:

- `authority_effect`
- `canonical`
- `project_claim_authority`
- `persistent_worker_proof`
- `w1_verified`
